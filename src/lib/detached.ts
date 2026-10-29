import { errorMessage } from "./utils";

/** Reports a rejected promise when an event handler cannot await it. */
export function detached<T>(promise: PromiseLike<T>, context: string): void {
  Promise.resolve(promise).catch((cause) => {
    reportError(new Error(`${context}: ${errorMessage(cause)}`, { cause }));
  });
}
