import { BrowserWindow } from 'electron';
import { PublicClientApplication, InteractionRequiredAuthError, ServerError, LogLevel, AuthenticationResult, Configuration, AccountInfo } from '@azure/msal-node';
import Store from 'electron-store';
import IpcChannels from './ipc-channels';
import { openExternalLink } from './external-links';
import { EnvironmentModel, AuthResponse, TokenResponse, EnvironmentsResponse, GenericResponse } from './types';
import * as http from 'http';
import { EncryptedCachePlugin } from './token-cache';
import { handleTrusted } from './trusted-ipc';
import { dataverseOrigin, toEnvironmentModel } from './dataverse-hosts';
import { app } from 'electron';

// Custom protocol for deep linking
const APP_PROTOCOL = 'powerexplorer';
const DEEP_LINK_URL = `${APP_PROTOCOL}://auth`;

// MSAL error codes for a request that got no usable answer from Microsoft
const NETWORK_ERROR_CODES = ['network_error', 'endpoints_resolution_error', 'openid_config_error'];
const INVALID_ENVIRONMENT_ERROR = 'This is not a supported Dataverse environment address';
// OAuth codes by which Microsoft declines this account or application. A list of what counts, not of
// what does not: after an outage or throttling MSAL replays the failure with an empty or numeric code
const REFUSAL_ERROR_CODES = ['invalid_resource', 'invalid_client', 'unauthorized_client', 'invalid_scope', 'invalid_request', 'access_denied'];

interface InteractiveRequest {
    scopes: string[];
    openBrowser: (url: string) => Promise<void>;
    successTemplate?: string;
    errorTemplate?: string;
    redirectUri: string;
    authority?: string;
}

// This module handles Microsoft authentication in Electron
class AuthHandler {
    private mainWindow: BrowserWindow;
    private pca: PublicClientApplication | null;
    private store: Store;
    private authority: string = 'https://login.microsoftonline.com/common';
    private clientId: string = '51f81489-12ee-4a9e-aaae-a2591f45987d';
    private redirectUri: string = 'http://localhost';
    private loginTimeoutMs = 5 * 60 * 1000;
    // The only interactive sign-in that may be running at a time
    private activeLogin: {
        environmentModel: EnvironmentModel;
        result: Promise<AuthenticationResult>;
        abort: (reason: Error) => void;
    } | null = null;

    constructor(mainWindow: BrowserWindow) {
        this.mainWindow = mainWindow;
        this.pca = null;
        this.store = new Store({ name: 'power-explorer-settings' });

        this.initializeMsal();

        this.registerIpcHandlers();
    }

    // The handler outlives its window: IPC handlers can be registered only once
    setMainWindow(mainWindow: BrowserWindow): void {
        this.mainWindow = mainWindow;
    }

    private sendToRenderer(channel: string, ...args: unknown[]): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, ...args);
        }
    }

    initializeMsal() {
        try {
            const cachePlugin = new EncryptedCachePlugin();
            
            const msalConfig: Configuration = {
                auth: {
                    clientId: this.clientId,
                    authority: this.authority
                },
                system: {
                    loggerOptions: {
                        loggerCallback: (level, message, containsPii) => {
                            if (containsPii) return;
                            console.log(`[MSAL-${level}] ${message}`);
                        },
                        piiLoggingEnabled: false,
                        logLevel: app.isPackaged ? LogLevel.Error : LogLevel.Warning,
                    },
                },
                cache: {
                    cachePlugin
                }
            };

            this.pca = new PublicClientApplication(msalConfig);
        } catch (error) {
            console.error('[AUTH-HANDLER] Error initializing MSAL:', error);
        }
    }

    registerIpcHandlers() {
        // Handle authentication requests from the renderer process
        handleTrusted(IpcChannels.AUTH_LOGIN, async (event, requested: unknown): Promise<AuthResponse> => {
            try {
                const environmentModel = toEnvironmentModel(requested);
                if (!environmentModel) {
                    return { success: false, error: INVALID_ENVIRONMENT_ERROR };
                }

                const result = await this.login(environmentModel);

                // Save the environment model with auth config
                this.updateStoredEnvironments(environmentModel);

                // Make sure to save the account immediately
                this.storeActiveAccount(result.account);

                return { success: true, account: result.account };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error during login';
                return { success: false, error: errorMessage };
            }
        });

        // Handle token acquisition. Silent only: signing in is always the user's decision
        handleTrusted(IpcChannels.AUTH_GET_TOKEN, async (event, environmentModel: EnvironmentModel): Promise<TokenResponse> => {
            try {
                return await this.getToken(environmentModel);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error getting token';
                return { success: false, error: errorMessage };
            }
        });

        // Handle log out requests
        handleTrusted(IpcChannels.AUTH_LOGOUT, async (): Promise<GenericResponse> => {
            try {
                await this.logout();
                return { success: true };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error during logout';
                return { success: false, error: errorMessage };
            }
        });

        // Handle get active account request
        handleTrusted(IpcChannels.AUTH_GET_ACTIVE_ACCOUNT, async (): Promise<AccountInfo | null> => {
            console.log('[AUTH-HANDLER] Direct getActiveAccount handler called');
            try {
                const account = await this.getActiveAccount();
                console.log('[AUTH-HANDLER] Direct getActiveAccount result:', account ? 'Account found' : 'No account');
                return account;
            } catch (error) {
                console.error('[AUTH-HANDLER] Direct getActiveAccount error:', error);
                return null;
            }
        });

        // Handle get cached environments request
        handleTrusted(IpcChannels.ENV_GET_MODELS, async (): Promise<EnvironmentsResponse> => {
            try {
                const environments = this.getEnvironmentModels();
                return { success: true, environments };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error getting cached environments';
                return { success: false, error: errorMessage };
            }
        });

        // Handle delete cached environment request
        handleTrusted(IpcChannels.ENV_DELETE_MODEL, async (event, environmentModel: EnvironmentModel): Promise<GenericResponse> => {
            try {
                this.deleteEnvironmentModel(environmentModel);
                return { success: true };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error deleting cached environment';
                return { success: false, error: errorMessage };
            }
        });

        handleTrusted(IpcChannels.ENV_SET_ACTIVE, async (event, requested: unknown): Promise<GenericResponse> => {
            try {
                const environmentModel = toEnvironmentModel(requested);
                if (!environmentModel) {
                    return { success: false, error: INVALID_ENVIRONMENT_ERROR };
                }

                const result = await this.setActiveEnvironment(environmentModel);
                return { success: result };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error setting active environment';
                return { success: false, error: errorMessage };
            }
        });

        handleTrusted(IpcChannels.ENV_GET_ACTIVE, async (): Promise<EnvironmentsResponse> => {
            try {
                const activeEnv = this.getActiveEnvironment();
                return { success: true, environment: activeEnv };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error getting active environment';
                return { success: false, error: errorMessage };
            }
        });

        // Add new handler for auth redirect from renderer
        handleTrusted(IpcChannels.AUTH_HANDLE_REDIRECT, async (event, params: Record<string, string>): Promise<GenericResponse> => {
            try {
                await this.handleAuthRedirect(params);
                return { success: true };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error handling redirect';
                return { success: false, error: errorMessage };
            }
        });
    }

    // Handle auth redirect when returning from browser
    async handleAuthRedirect(params: Record<string, string>): Promise<void> {
        console.log('[AUTH-HANDLER] Handling auth deep link or redirect');
        
        // Focus the main window - ensure it's visible and brought to front
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
            }
            this.mainWindow.focus();
            this.mainWindow.moveTop(); // Ensure window is on top of others
            
            // Send notification to the renderer
            this.sendToRenderer('app-returned-from-auth');
        }
    }

    // A repeated request for the same environment joins the running sign-in;
    // a request for another environment aborts it first
    login(environmentModel: EnvironmentModel): Promise<AuthenticationResult> {
        if (this.activeLogin) {
            if (this.activeLogin.environmentModel.apiUrl === environmentModel.apiUrl) {
                return this.activeLogin.result;
            }
            this.activeLogin.abort(new Error('Sign-in was replaced by a sign-in to another environment'));
        }

        let abort: (reason: Error) => void;
        let abortReason: Error | null = null;
        let signInUrl: string | null = null;
        const aborted = new Promise<never>((_, reject) => {
            abort = (reason: Error) => {
                if (abortReason) return;
                abortReason = reason;
                reject(reason);
                this.stopLoopbackListener(signInUrl);
            };
        });
        const onBrowserUrl = (url: string) => {
            // Aborted before MSAL got as far as the browser: make it fail and close its listener
            if (abortReason) throw abortReason;
            signInUrl = url;
        };

        const timeoutId = setTimeout(() => abort(new Error('Authentication timed out')), this.loginTimeoutMs);
        const attempt = { environmentModel: { ...environmentModel }, abort, result: null as Promise<AuthenticationResult> };
        this.activeLogin = attempt;

        attempt.result = Promise.race([this.runInteractiveLogin(environmentModel, onBrowserUrl, () => abortReason), aborted])
            .finally(() => {
                clearTimeout(timeoutId);
                if (this.activeLogin === attempt) {
                    this.activeLogin = null;
                }
            });

        return attempt.result;
    }

    // MSAL's loopback listener has no timeout and cannot be cancelled from outside.
    // Answering it with an error redirect makes acquireTokenInteractive fail and close it.
    private stopLoopbackListener(signInUrl: string | null): void {
        if (!signInUrl) return;

        try {
            const redirectUri = new URL(new URL(signInUrl).searchParams.get('redirect_uri'));
            http.get({ host: '127.0.0.1', port: redirectUri.port, path: '/?error=access_denied' }, response => response.resume())
                .on('error', () => { /* the listener is already closed */ });
        } catch (error) {
            console.warn('[AUTH-HANDLER] Could not close the sign-in listener:', (error as Error)?.name);
        }
    }

    private async runInteractiveLogin(
        environmentModel: EnvironmentModel,
        onBrowserUrl: (url: string) => void,
        getAbortReason: () => Error | null
    ): Promise<AuthenticationResult> {
        const scopes = [`${environmentModel.apiUrl}/user_impersonation`];

        try {
            console.log('[AUTH-HANDLER] Starting login process with interactive token acquisition');

            // Create HTML templates for success and error pages with a button to go back to the app
            const successTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Complete</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background-color: #f0f0f0;
            }
            .container {
              text-align: center;
              padding: 2rem;
              max-width: 450px;
            }
            h2 {
              color: #414141;
              margin-bottom: 1rem;
            }            
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Authentication Complete</h2>
          </div>
          
          <script>
            // Automatically redirect to the app after a short delay
            setTimeout(() => {
              window.location.href = "${DEEP_LINK_URL}";
            }, 500); 
          </script>
        </body>
        </html>
      `;

            const errorTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background-color: #f0f0f0;
            }
            .container {
              text-align: center;
              padding: 2rem;
              max-width: 450px;
            }
            h2 {
              color: #d83b01;
              margin-bottom: 1rem;
            }
            p {
              margin-bottom: 1.5rem;
              color: #333;
              line-height: 1.5;
            }
            .error-details {
              font-size: 0.9rem;
              color: #666;
              margin-bottom: 1.5rem;
              padding: 10px;
              background-color: #f8f8f8;
              border-radius: 4px;
              border-left: 3px solid #d83b01;
              text-align: left;
              word-break: break-word;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Authentication Failed</h2>
            <p>There was a problem with the authentication process.</p>
            <div class="error-details" id="errorDetails"></div>
          </div>
          
          <script>
            // Get error from URL if available
            const urlParams = new URLSearchParams(window.location.search);
            const error = urlParams.get('error');
            const errorDesc = urlParams.get('error_description');
            if (error || errorDesc) {
              document.getElementById('errorDetails').textContent = errorDesc || error;
            } else {
              document.getElementById('errorDetails').style.display = 'none';
            }
            
            // Automatically redirect to the app after a short delay
            setTimeout(() => {
              window.location.href = "${DEEP_LINK_URL}";
            }, 500);
          </script>
        </body>
        </html>
      `;

            // Browser open function
            const openBrowser = async (url: string) => {
                onBrowserUrl(url);
                console.log('[AUTH-HANDLER: LOGIN] Opening browser for sign-in');
                if (!await openExternalLink(url)) {
                    throw new Error('Could not open the sign-in page');
                }
            };

            // Start the login process
            const interactiveRequest: InteractiveRequest = {
                scopes: scopes,
                openBrowser: openBrowser,
                redirectUri: this.redirectUri,
                authority: this.authority,
                successTemplate: successTemplate,
                errorTemplate: errorTemplate
            };

            const response = await this.pca.acquireTokenInteractive(interactiveRequest);

            // A response that arrives after the abort must not change the stored state
            if (!getAbortReason()) {
                this.updateStoredEnvironments(environmentModel);
                this.storeActiveAccount(response.account);
            }

            return response;
        } catch (error) {
            console.error('[AUTH-HANDLER] Error during interactive login:', error);
            throw error;
        }
    }

    // Tokens are handed out for saved environments only, and the scope comes from the saved model:
    // what the window sends just picks one of them
    async getToken(requested: EnvironmentModel): Promise<TokenResponse> {
        const environmentModel = this.findStoredEnvironment(requested);
        if (!environmentModel) {
            return { success: false, error: 'This environment is not saved. Connect to it again.' };
        }
        return this.acquireTokenSilently(environmentModel);
    }

    // The active environment counts too: it may be missing from the capped list of recent ones.
    // Stored models are checked and normalized again, earlier versions saved them as typed
    private findStoredEnvironment(requested: EnvironmentModel): EnvironmentModel | null {
        const origin = dataverseOrigin(requested?.apiUrl);
        if (!origin) return null;

        const stored = [...this.getEnvironmentModels(), this.getActiveEnvironment()]
            .find(model => dataverseOrigin(model?.apiUrl) === origin);
        return stored ? { ...stored, apiUrl: origin } : null;
    }

    // Never opens the browser. `refused` marks an answer where Microsoft declined this account,
    // which a sign-in may fix; network failures and outages are plain errors
    private async acquireTokenSilently(environmentModel: EnvironmentModel): Promise<TokenResponse> {
        const activeAccount = await this.getActiveAccount();
        if (!activeAccount) {
            return { success: false, loginRequired: true };
        }

        try {
            const response = await this.pca.acquireTokenSilent({
                account: activeAccount,
                scopes: [`${environmentModel.apiUrl}/user_impersonation`],
                authority: this.authority
            });
            console.log('[AUTH-HANDLER: GET-TOKEN] Acquired token silently');
            return { success: true, accessToken: response.accessToken };
        } catch (error) {
            const errorCode: string = (error as { errorCode?: string })?.errorCode;
            if (error instanceof InteractionRequiredAuthError || errorCode === 'invalid_grant') {
                return { success: false, loginRequired: true };
            }
            console.warn('[AUTH-HANDLER: GET-TOKEN] Silent token request failed:', errorCode || (error as Error)?.name);

            if (NETWORK_ERROR_CODES.includes(errorCode)) {
                return { success: false, error: 'Could not get an access token. Check your network connection.' };
            }
            if (error instanceof ServerError && REFUSAL_ERROR_CODES.includes(errorCode)) {
                return { success: false, refused: true, error: `Microsoft refused to issue a token for this environment (${errorCode}).` };
            }
            return { success: false, error: `Could not get an access token (${errorCode || 'unknown error'}).` };
        }
    }

    async logout(): Promise<void> {
        const activeAccount = await this.getActiveAccount();
        if (activeAccount) {
            try {
                await this.pca.getTokenCache().removeAccount(activeAccount);
                this.removeActiveAccount();
                this.removeActiveEnvironment();
            } catch (error) {
                throw error;
            }
        }
    }

    // Environment model methods
    updateStoredEnvironments(environmentModel: EnvironmentModel): void {
        if (!environmentModel || !environmentModel.url) return;

        try {
            const models = this.getEnvironmentModels();

            // An earlier version may have saved the same address in another spelling
            const existingIndex = models.findIndex(env => dataverseOrigin(env.url) === environmentModel.url);

            if (existingIndex >= 0) {
                models.splice(existingIndex, 1);
            }
            
            models.unshift(environmentModel);
            
            const MAX_ENVIRONMENTS = 6;
            if (models.length > MAX_ENVIRONMENTS) {
                models.splice(MAX_ENVIRONMENTS, models.length - MAX_ENVIRONMENTS);
            }

            this.store.set('environmentModels', models);
        } catch (error) {
            console.error('[AUTH-HANDLER] Error saving environment model:', error);
        }
    }

    getEnvironmentModels(): EnvironmentModel[] {
        try {
            return this.store.get('environmentModels', []) as EnvironmentModel[];
        } catch (error) {
            console.error('[AUTH-HANDLER] Error getting environment models:', error);
            return [];
        }
    }

    deleteEnvironmentModel(environmentModel: EnvironmentModel): void {
        if (!environmentModel) return;

        try {
            // Get existing models with explicit type cast
            const models = this.getEnvironmentModels();

            // Remove model with matching URL
            const updatedModels = models.filter(env => env.url !== environmentModel.url);

            // Save updated models
            this.store.set('environmentModels', updatedModels);

            // If active environment was deleted, set active to null
            const activeEnv = this.getActiveEnvironment();
            if (activeEnv && activeEnv.url === environmentModel.url) {
                this.store.delete('activeEnvironment');
            }
        } catch (error) {
            console.error('[AUTH-HANDLER] Error deleting environment model:', error);
        }
    }

    async getActiveAccount(): Promise<AccountInfo | null> {
        try {
            // First try to get the active account ID from store
            const activeAccountId = this.store.get('activeAccountId', null) as string;
            
            if (!activeAccountId || !this.pca) {
                return null;
            }
            
            // Use the MSAL token cache to get all accounts
            const accounts = await this.pca.getTokenCache().getAllAccounts();
            
            // Find the account that matches the stored ID
            const msalAccount = accounts.find(account => account.homeAccountId === activeAccountId) || null;
            
            // Create a clean version of the account for IPC transfer
            if (msalAccount) {
                const cleanAccount: AccountInfo = {
                    homeAccountId: msalAccount.homeAccountId,
                    environment: msalAccount.environment,
                    tenantId: msalAccount.tenantId,
                    username: msalAccount.username,
                    localAccountId: msalAccount.localAccountId,
                    name: msalAccount.name
                };
                
                return cleanAccount;
            }
            
            return null;
        } catch (error) {
            console.error('[AUTH-HANDLER] Error getting active account from cache:', error);
            return null;
        }
    }

    storeActiveAccount(account: AccountInfo): void {
        try {
            if (!account || !account.homeAccountId) {
                console.error('[AUTH-HANDLER: SET-ACTIVE-ACCOUNT] Invalid account');
                return;
            }
            
            // Store just the account ID instead of the full object
            this.store.set('activeAccountId', account.homeAccountId);
            
            // Force immediate save to disk
            if (typeof this.store.store === 'function') {
                console.log('[AUTH-HANDLER: SET-ACTIVE-ACCOUNT] Flushing store to disk');
                this.store.store();
            }
            
            // Create a clean account object for IPC transfer
            const cleanAccount: AccountInfo = {
                homeAccountId: account.homeAccountId,
                environment: account.environment,
                tenantId: account.tenantId,
                username: account.username,
                localAccountId: account.localAccountId,
                name: account.name
            };
            
            // Emit account changed event to renderer process
            this.sendToRenderer('account-changed', cleanAccount);
        } catch (error) {
            console.error('[AUTH-HANDLER] Error setting active account:', error);
        }
    }

    removeActiveAccount(): void {
        try {
            this.store.delete('activeAccountId');
            // Emit account changed event with null to renderer process
            this.sendToRenderer('account-changed', null);
        } catch (error) {
            console.error('[AUTH-HANDLER] Error removing active account:', error);
        }
    }

    async setActiveEnvironment(environmentModel: EnvironmentModel): Promise<boolean> {
        if (!environmentModel) return false;

        try {            
            // Not necessarily saved yet; the IPC handler has validated it
            const token = await this.acquireTokenSilently(environmentModel);

            if (token.loginRequired || token.refused) {
                // Connecting is the user's own action, so signing in here is expected.
                // A refusal can mean the active account belongs to another tenant
                await this.login(environmentModel);
            } else if (!token.success) {
                return false;
            }

            this.store.set('activeEnvironment', environmentModel);
            this.sendToRenderer('environment-changed', environmentModel);
            return true;
        } catch (error) {
            console.error('[AUTH-HANDLER] Error setting active environment:', error);
            return false;
        }
    }

    removeActiveEnvironment(): void {
        try {
            this.store.delete('activeEnvironment');
            // Emit environment changed event with null to renderer process
            this.sendToRenderer('environment-changed', null);
        } catch (error) {
            console.error('[AUTH-HANDLER] Error removing active environment:', error);
        }
    }

    getActiveEnvironment(): EnvironmentModel | null {
        try {
            return this.store.get('activeEnvironment', null) as EnvironmentModel;
        } catch (error) {
            return null;
        }
    }
}

export default AuthHandler; 