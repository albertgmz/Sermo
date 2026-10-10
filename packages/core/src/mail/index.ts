import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  messageId: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<SendResult>;
  close?(): void;
}

export type MailConfig =
  | { driver: "none"; sender: string; replyTo?: string }
  | { driver: "capture"; sender: string; replyTo?: string }
  | {
      driver: "smtp";
      sender: string;
      replyTo?: string;
      host: string;
      port: number;
      secure: boolean;
      user?: string;
      password?: string;
      /** Require STARTTLS. Defaults to true unless `secure` is set or the host is loopback. */
      requireTLS?: boolean;
    };

export class CaptureMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<SendResult> {
    this.messages.push(structuredClone(message));
    return { messageId: message.messageId ?? `<capture-${this.messages.length}@sermo.local>` };
  }
}

/** True for "localhost", any 127.0.0.0/8 address and IPv6 loopback (with or without brackets). */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase();
  if (name === "localhost" || name === "::1" || name === "[::1]") return true;
  const octets = name.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

export function smtpMailer(config: Extract<MailConfig, { driver: "smtp" }>): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    pool: true,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
    requireTLS: config.requireTLS ?? (!config.secure && !isLoopbackHost(config.host)),
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? "" } } : {}),
  });
  return {
    async send(message) {
      const result = await transport.sendMail(message);
      return { messageId: result.messageId };
    },
    close() {
      transport.close();
    },
  };
}

export const noneMailer: Mailer = {
  async send() {
    throw new Error("Email delivery is disabled.");
  },
};
