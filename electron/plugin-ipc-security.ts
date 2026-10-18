import { isTrustedRendererUrl } from './security';

interface IpcSenderFrameLike {
  url: string;
}

interface IpcSenderEventLike {
  senderFrame: IpcSenderFrameLike | null;
  sender: {
    mainFrame: IpcSenderFrameLike;
  };
}

/** Accept plugin-management IPC only from the trusted application's main renderer frame. */
export function isTrustedDesktopSender(event: IpcSenderEventLike, trustedRendererUrl: string): boolean {
  const frame = event.senderFrame;
  return frame !== null
    && frame === event.sender.mainFrame
    && isTrustedRendererUrl(frame.url, trustedRendererUrl);
}
