import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { EnvironmentModel, AuthResponse, TokenResponse } from './types';
import { AccountInfo } from '@azure/msal-node';

// Authentication channels
const AUTH_LOGIN = 'login';
const AUTH_GET_TOKEN = 'getToken';
const AUTH_LOGOUT = 'logout';
// const AUTH_SET_ENVIRONMENT_URL = 'setEnvironmentUrl'; // Removing non-implemented method
const AUTH_GET_ACTIVE_ACCOUNT = 'getActiveAccount';
const AUTH_HANDLE_REDIRECT = 'handleRedirect';
// Environment model channels
const ENV_GET_MODELS = 'getEnvironmentModels';
const ENV_DELETE_MODEL = 'deleteEnvironmentModel';
const ENV_SET_ACTIVE = 'setActiveEnvironment';
const ENV_GET_ACTIVE = 'getActiveEnvironment';

// Auto-update channels
const UPDATE_CHECK = 'check-for-updates';
const UPDATE_DOWNLOAD = 'download-update';
const UPDATE_QUIT_INSTALL = 'quit-and-install';

// All channels in a single object
const IpcChannels = {
  AUTH_LOGIN,
  AUTH_GET_TOKEN,
  AUTH_GET_ACTIVE_ACCOUNT,
  AUTH_LOGOUT,
  // AUTH_SET_ENVIRONMENT_URL, // Removing non-implemented method
  AUTH_HANDLE_REDIRECT,
  ENV_GET_MODELS,
  ENV_DELETE_MODEL,
  ENV_SET_ACTIVE,
  ENV_GET_ACTIVE,
  UPDATE_CHECK,
  UPDATE_DOWNLOAD,
  UPDATE_QUIT_INSTALL,
};


// Define types for the exposed APIs
interface ElectronAPI {
    send: (channel: string, data?: any) => void;
    receive: (channel: string, func: (...args: any[]) => void) => void;
    auth: {
        login: (environmentModel: EnvironmentModel) => Promise<AuthResponse>;
        getToken: (environmentModel: EnvironmentModel) => Promise<TokenResponse>;
        logout: () => Promise<void>;
        getActiveAccount: () => Promise<AccountInfo | null>;
        handleAuthRedirect: (params: any) => Promise<void>;
        handleRedirect: (params: any) => Promise<any>;
    };
    environment: {
        getModels: () => Promise<EnvironmentModel[]>;
        deleteModel: (environmentModel: EnvironmentModel) => Promise<any>;
        setActive: (environmentModel: EnvironmentModel) => Promise<boolean>;
        getActive: () => Promise<EnvironmentModel | null>;
    };
    updater: {
        checkForUpdates: () => Promise<any>;
        downloadUpdate: () => Promise<any>;
        quitAndInstall: () => Promise<void>;
        onUpdateAvailable: (callback: (info: any) => void) => () => void;
        onUpdateNotAvailable: (callback: (info: any) => void) => () => void;
        onUpdateError: (callback: (error: string) => void) => () => void;
        onUpdateProgress: (callback: (progressObj: any) => void) => () => void;
        onUpdateDownloaded: (callback: (info: any) => void) => () => void;
    };
    openExternal: (url: string) => Promise<boolean>;
    isElectron: boolean;
}

// Create the main electron API object
const electronAPI: ElectronAPI = {
    send: (channel: string, data?: any) => {
        // whitelist channels
        const validChannels = ['app-ready'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    receive: (channel: string, func: (...args: any[]) => void) => {
        const validChannels = [
            'deep-link', 'update-available', 'update-not-available', 'update-error', 'update-progress', 'update-downloaded',
            'account-changed', 'environment-changed', 'auth-success', 'auth-failed', 'app-returned-from-auth'
        ];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender` 
            ipcRenderer.on(channel, (_event: IpcRendererEvent, ...args: any[]) => func(...args));
        }
    },
    auth: {
        login: (environmentModel: EnvironmentModel) => ipcRenderer.invoke(IpcChannels.AUTH_LOGIN, environmentModel),
        getToken: (environmentModel: EnvironmentModel) => ipcRenderer.invoke(IpcChannels.AUTH_GET_TOKEN, environmentModel),
        logout: () => ipcRenderer.invoke(IpcChannels.AUTH_LOGOUT),
        getActiveAccount: () => ipcRenderer.invoke(IpcChannels.AUTH_GET_ACTIVE_ACCOUNT),
        handleAuthRedirect: (params: any) => ipcRenderer.invoke(IpcChannels.AUTH_HANDLE_REDIRECT, params),
        handleRedirect: (params: any) => ipcRenderer.invoke(IpcChannels.AUTH_HANDLE_REDIRECT, params)
    },
    environment: {
        getModels: () => ipcRenderer.invoke(IpcChannels.ENV_GET_MODELS),
        deleteModel: (environmentModel: EnvironmentModel) => ipcRenderer.invoke(IpcChannels.ENV_DELETE_MODEL, environmentModel),
        setActive: (environmentModel: EnvironmentModel) => ipcRenderer.invoke(IpcChannels.ENV_SET_ACTIVE, environmentModel),
        getActive: () => ipcRenderer.invoke(IpcChannels.ENV_GET_ACTIVE)
    },
    updater: {
        checkForUpdates: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
        downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD),
        quitAndInstall: () => ipcRenderer.invoke(IpcChannels.UPDATE_QUIT_INSTALL),
        onUpdateAvailable: (callback: (info: any) => void) => {
            const listener = (_event: IpcRendererEvent, info: any) => callback(info);
            ipcRenderer.on('update-available', listener);
            return () => { ipcRenderer.removeListener('update-available', listener); };
        },
        onUpdateNotAvailable: (callback: (info: any) => void) => {
            const listener = (_event: IpcRendererEvent, info: any) => callback(info);
            ipcRenderer.on('update-not-available', listener);
            return () => { ipcRenderer.removeListener('update-not-available', listener); };
        },
        onUpdateError: (callback: (error: string) => void) => {
            const listener = (_event: IpcRendererEvent, error: string) => callback(error);
            ipcRenderer.on('update-error', listener);
            return () => { ipcRenderer.removeListener('update-error', listener); };
        },
        onUpdateProgress: (callback: (progressObj: any) => void) => {
            const listener = (_event: IpcRendererEvent, progressObj: any) => callback(progressObj);
            ipcRenderer.on('update-progress', listener);
            return () => { ipcRenderer.removeListener('update-progress', listener); };
        },
        onUpdateDownloaded: (callback: (info: any) => void) => {
            const listener = (_event: IpcRendererEvent, info: any) => callback(info);
            ipcRenderer.on('update-downloaded', listener);
            return () => { ipcRenderer.removeListener('update-downloaded', listener); };
        }
    },
    openExternal: (url: string) =>
        ipcRenderer.invoke('open-external', url),
    isElectron: true
};

contextBridge.exposeInMainWorld('electron', electronAPI);
