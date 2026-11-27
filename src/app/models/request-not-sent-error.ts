/** A Dataverse request that was stopped before leaving the app because it had no usable token. */
export class RequestNotSentError extends Error {
  override readonly name = 'RequestNotSentError';

  constructor(message: string, readonly signInRequired: boolean = false) {
    super(message);
  }
}
