interface ElectronAPI {
  send: (channel: string, data?: any) => void;
  receive: (channel: string, func: (...args: any[]) => void) => void;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
  removeAllListeners: (channel: string) => void;
  invoke: (channel: string, data?: any) => Promise<any>;
  /** Resolves a renderer File chosen through drag-and-drop to its local path. */
  getPathForFile: (file: File) => string;
}

declare interface Window {
  electron: ElectronAPI;
}
