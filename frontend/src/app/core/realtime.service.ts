import { Injectable, inject, signal } from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { Auth } from './auth.service';
import { ChatMessage, Notification } from './models';

export interface MessageEvent {
  conversationId: number;
  message: ChatMessage;
}

export interface TypingEvent {
  conversationId: number;
  userId: number;
  username: string;
}

export interface ReadEvent {
  conversationId: number;
  userId: number;
  messageId: number;
}

export interface PresenceEvent {
  userId: number;
  online: boolean;
  lastActiveAt: string;
}

export interface StoryEvent {
  userId: number;
  username: string;
}

/**
 * The socket, and the only place in the app that knows one exists.
 *
 * <p>
 * Screens subscribe to the stream they care about and never touch the connection. That matters more than
 * it sounds: it means every screen can be written as though the data simply arrives, and the reconnect,
 * the token, the back-off and the "you were away, refetch" problem are solved once here rather than five
 * times badly.
 * </p>
 *
 * <p>
 * Nothing is <em>only</em> realtime. Every stream has an HTTP endpoint behind it that returns the same
 * thing, and every screen still fetches on open. A socket makes the app feel live; it is never the sole
 * route by which something is true, because a dropped frame would then be a permanently wrong screen.
 * That is what <code>resynced</code> is for — after a reconnection, screens refetch rather than assuming
 * they caught everything that happened while they were away.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class Realtime {
  private readonly auth = inject(Auth);

  private connection?: HubConnection;

  /** True while the socket is up. The UI uses it to decide whether to fall back to polling. */
  readonly connected = signal(false);

  readonly message$ = new Subject<MessageEvent>();
  readonly messageChanged$ = new Subject<MessageEvent>();
  readonly typing$ = new Subject<TypingEvent>();
  readonly read$ = new Subject<ReadEvent>();
  readonly presence$ = new Subject<PresenceEvent>();
  readonly notification$ = new Subject<Notification>();
  readonly activityCount$ = new Subject<number>();
  readonly counts$ = new Subject<{ unread: number; requests: number }>();
  readonly story$ = new Subject<StoryEvent>();

  /** Somebody you follow posted a photo. Not the photo — the feed decides where it goes. */
  readonly post$ = new Subject<StoryEvent>();

  /** Fires after a reconnection. Anything showing a list should refetch it. */
  readonly resynced$ = new Subject<void>();

  async start() {
    if (this.connection || !this.auth.isSignedIn()) {
      return;
    }

    const connection = new HubConnectionBuilder()
      .withUrl(`${environment.hubUrl}/realtime`, {
        // A WebSocket handshake cannot carry an Authorization header, so the token rides in the query
        // string. The server accepts it there for the hub path and nowhere else.
        accessTokenFactory: () => this.auth.token() ?? '',
      })
      // Back off rather than hammer: immediately, then 2 s, 5 s, 10 s, then every 30 s.
      .withAutomaticReconnect([0, 2000, 5000, 10_000, 30_000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection = connection;

    connection.on('message', (event: MessageEvent) => this.message$.next(event));
    connection.on('messageChanged', (event: MessageEvent) => this.messageChanged$.next(event));
    connection.on('typing', (event: TypingEvent) => this.typing$.next(event));
    connection.on('read', (event: ReadEvent) => this.read$.next(event));
    connection.on('presence', (event: PresenceEvent) => this.presence$.next(event));
    connection.on('notification', (event: Notification) => this.notification$.next(event));
    connection.on('activityCount', (count: number) => this.activityCount$.next(count));
    connection.on('counts', (counts: { unread: number; requests: number }) => this.counts$.next(counts));
    connection.on('story', (event: StoryEvent) => this.story$.next(event));
    connection.on('post', (event: StoryEvent) => this.post$.next(event));

    connection.onreconnecting(() => this.connected.set(false));

    connection.onreconnected(() => {
      this.connected.set(true);

      // Whatever happened while the socket was down was not delivered, and never will be. Tell every
      // screen to ask again rather than pretend the gap did not exist.
      this.resynced$.next();
    });

    connection.onclose(() => this.connected.set(false));

    try {
      await connection.start();
      this.connected.set(true);
    } catch {
      // The app is fully usable over HTTP; the socket is an accelerator. A failed connection is not
      // worth interrupting anybody over, and automatic reconnect will keep trying.
      this.connected.set(false);
    }
  }

  async stop() {
    const connection = this.connection;
    this.connection = undefined;
    this.connected.set(false);

    if (connection) {
      try {
        await connection.stop();
      } catch {
        // Already gone.
      }
    }
  }

  /** Tells the server this account is typing. Silently ignored when the socket is down. */
  typing(conversationId: number) {
    if (this.connection?.state === HubConnectionState.Connected) {
      this.connection.invoke('Typing', conversationId).catch(() => undefined);
    }
  }
}
