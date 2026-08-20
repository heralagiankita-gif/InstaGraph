import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ActivitySummary,
  AuthResult,
  ChatCandidate,
  ChatMessage,
  Collection,
  Comment,
  ConnectionPath,
  Conversation,
  ConversationDetail,
  FollowResult,
  GraphVersion,
  Hashtag,
  Highlight,
  InboxCounts,
  LikeResult,
  ListMember,
  NetworkGraph,
  NetworkStats,
  Note,
  Notification,
  Page,
  Post,
  Profile,
  ReactionSummary,
  PasswordChangedResult,
  PasswordResetStarted,
  RegisteredResult,
  Relationship,
  SaveResult,
  SearchResults,
  SendCodeResult,
  Settings,
  Story,
  StoryHighlight,
  StoryTray,
  StoryViewer,
  SuggestedUser,
  SuggestionCategory,
  UsernameAvailability,
  UserRelation,
  UserSummary,
  VerifyCodeResult,
} from './models';

/**
 * One photo or clip on its way up, with everything the server cannot work out for itself.
 *
 * The measurements are taken in the browser because that is the only place they are cheap: the aspect
 * ratio comes off the decoded image, and the poster off the first frame of the video. There is no video
 * tooling on the server to grab either after the fact.
 */
export interface NewPostMedia {
  file: File;
  /** Width ÷ height, so the feed reserves the right space before the file lands. */
  aspectRatio: number;
  durationMs: number;
  /** A still from the first frame. Clips only — without one a video post has no thumbnail. */
  poster?: Blob | null;
}

/**
 * Every call the app makes, in one place. Components never build a URL themselves, so a route change on
 * the API is a change here and nowhere else.
 */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** Turns the API's relative /uploads/… path into something an <img> can load. */
  imageUrl(path: string | null | undefined): string {
    if (!path) return '';
    return path.startsWith('http') ? path : environment.filesUrl + path;
  }

  // ---------------------------------------------------------------------- auth

  login(login: string, password: string): Observable<AuthResult> {
    return this.http.post<AuthResult>(`${this.base}/auth/login`, { login, password });
  }

  /** Step one: ask for a six-digit code at an address no account is using yet. */
  startSignUp(email: string): Observable<SendCodeResult> {
    return this.http.post<SendCodeResult>(`${this.base}/auth/signup/start`, { email });
  }

  /** The same call behind a different name, so "I didn't get the code" reads as what it does. */
  resendCode(email: string): Observable<SendCodeResult> {
    return this.http.post<SendCodeResult>(`${this.base}/auth/signup/resend`, { email });
  }

  /** Step two: exchange the six digits for the token register requires. */
  verifyCode(email: string, code: string): Observable<VerifyCodeResult> {
    return this.http.post<VerifyCodeResult>(`${this.base}/auth/signup/verify`, { email, code });
  }

  /** Asked while somebody is still typing, so a taken name is caught before the form is submitted. */
  usernameAvailable(username: string): Observable<UsernameAvailability> {
    return this.http.get<UsernameAvailability>(`${this.base}/auth/username-available`, {
      params: new HttpParams().set('username', username),
    });
  }

  /** Step three. Returns a username rather than a session — the new account then logs in. */
  register(body: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    dateOfBirth: string;
    verificationToken: string;
  }): Observable<RegisteredResult> {
    return this.http.post<RegisteredResult>(`${this.base}/auth/register`, body);
  }

  me(): Observable<UserSummary> {
    return this.http.get<UserSummary>(`${this.base}/auth/me`);
  }

  // --------------------------------------------------------- forgotten passwords

  /**
   * Step one of a reset, by username or email.
   *
   * <p>
   * Succeeds either way — the server refuses to confirm which accounts exist, so there is no error
   * here to catch and no branch for the screen to take.
   * </p>
   */
  forgotPassword(login: string): Observable<PasswordResetStarted> {
    return this.http.post<PasswordResetStarted>(`${this.base}/auth/password/forgot`, { login });
  }

  /** The same call under the name the "I didn't get the code" button deserves. */
  resendResetCode(login: string): Observable<PasswordResetStarted> {
    return this.http.post<PasswordResetStarted>(`${this.base}/auth/password/resend`, { login });
  }

  /** Step two: six digits for the single-use token the reset needs. */
  verifyResetCode(login: string, code: string): Observable<VerifyCodeResult> {
    return this.http.post<VerifyCodeResult>(`${this.base}/auth/password/verify`, { login, code });
  }

  /** Step three. Ends every older session and hands back one to replace them. */
  resetPassword(login: string, resetToken: string, newPassword: string): Observable<PasswordChangedResult> {
    return this.http.post<PasswordChangedResult>(`${this.base}/auth/password/reset`, {
      login,
      resetToken,
      newPassword,
    });
  }

  /** The settings route to the same place: the current password instead of an emailed code. */
  changePassword(currentPassword: string, newPassword: string): Observable<PasswordChangedResult> {
    return this.http.post<PasswordChangedResult>(`${this.base}/auth/password/change`, {
      currentPassword,
      newPassword,
    });
  }

  // ---------------------------------------------------------------------- feed

  feed(page: number, pageSize = 8): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/feed`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  explore(page: number, pageSize = 24): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/feed/explore`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  /** Accounts you follow who posted in the last 24 hours — the ring row. */
  highlights(): Observable<Highlight[]> {
    return this.http.get<Highlight[]>(`${this.base}/feed/highlights`);
  }

  // --------------------------------------------------------------------- posts
  post(id: number): Observable<Post> {
    return this.http.get<Post>(`${this.base}/posts/${id}`);
  }
  
  /**
   * Multipart, because this one carries actual files — one to ten of them, in the order they are meant
   * to be swiped through.
   *
   * The parallel `aspectRatios` and `durations` fields line up with `media` by position. The posters do
   * not: only the clips have one, so each names the item it belongs to instead.
   */
  createPost(
    items: NewPostMedia[],
    caption: string,
    location: string,
    options: { commentsDisabled?: boolean; hideCounts?: boolean } = {},
  ): Observable<Post> {
    const form = new FormData();

    items.forEach((item, index) => {
      form.append('media', item.file);
      form.append('aspectRatios', String(item.aspectRatio || 1));
      form.append('durations', String(Math.round(item.durationMs || 0)));

      if (item.poster) {
        form.append('posters', item.poster, `poster-${index}.jpg`);
        form.append('posterFor', String(index));
      }
    });

    form.append('caption', caption);
    if (location) form.append('location', location);
    if (options.commentsDisabled) form.append('commentsDisabled', 'true');
    if (options.hideCounts) form.append('hideCounts', 'true');

    return this.http.post<Post>(`${this.base}/posts`, form);
  }

  /** Replaces the whole set of people named in the photo. */
  setPostTags(
    id: number,
    tags: { userId: number; mediaPosition: number; x: number; y: number }[],
  ): Observable<Post> {
    return this.http.put<Post>(`${this.base}/posts/${id}/tags`, { tags });
  }

  archivePost(id: number): Observable<Post> {
    return this.http.post<Post>(`${this.base}/posts/${id}/archive`, {});
  }

  unarchivePost(id: number): Observable<Post> {
    return this.http.delete<Post>(`${this.base}/posts/${id}/archive`);
  }

  pinPost(id: number): Observable<Post> {
    return this.http.post<Post>(`${this.base}/posts/${id}/pin`, {});
  }

  unpinPost(id: number): Observable<Post> {
    return this.http.delete<Post>(`${this.base}/posts/${id}/pin`);
  }

  /** Counts a play. Once per viewer, however many times they watch it. */
  viewPost(id: number): Observable<number> {
    return this.http.post<number>(`${this.base}/posts/${id}/view`, {});
  }

  /** Your archive — posts you have put away. Only ever your own. */
  archived(page = 1, pageSize = 12): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/users/me/archive`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  /** Photos an account has been named in — the Tagged tab. */
  taggedPosts(username: string, page = 1, pageSize = 12): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/users/${username}/tagged`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  // --------------------------------------------------------------------- reels

  /** The vertical feed. Ranked mostly on what a clip has drawn rather than on who posted it. */
  reels(page: number, pageSize = 6): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/feed/reels`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  // --------------------------------------------------------------- collections

  collections(): Observable<Collection[]> {
    return this.http.get<Collection[]>(`${this.base}/users/me/collections`);
  }

  createCollection(name: string): Observable<Collection> {
    return this.http.post<Collection>(`${this.base}/users/me/collections`, { name });
  }

  renameCollection(id: number, name: string): Observable<Collection> {
    return this.http.put<Collection>(`${this.base}/users/me/collections/${id}`, { name });
  }

  /** Removes the folder. What was in it goes back to being saved and unsorted. */
  deleteCollection(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/users/me/collections/${id}`);
  }

  /** Files a saved post into a folder, or out of them all when the id is null. */
  filePost(postId: number, collectionId: number | null): Observable<void> {
    return this.http.put<void>(`${this.base}/posts/${postId}/collection`, { collectionId });
  }

  // ---------------------------------------------------------- story highlights

  /** The circles under somebody's bio. Covers only — the photos come when one is opened. */
  storyHighlights(username: string): Observable<StoryHighlight[]> {
    return this.http.get<StoryHighlight[]>(`${this.base}/highlights/user/${username}`);
  }

  storyHighlight(id: number): Observable<StoryHighlight> {
    return this.http.get<StoryHighlight>(`${this.base}/highlights/${id}`);
  }

  createStoryHighlight(title: string, storyIds: number[]): Observable<StoryHighlight> {
    return this.http.post<StoryHighlight>(`${this.base}/highlights`, { title, storyIds });
  }

  updateStoryHighlight(
    id: number,
    body: { title?: string; coverStoryId?: number; storyIds?: number[] },
  ): Observable<StoryHighlight> {
    return this.http.put<StoryHighlight>(`${this.base}/highlights/${id}`, body);
  }

  deleteStoryHighlight(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/highlights/${id}`);
  }

  /** Every story you have ever posted, live and expired alike. Yours and nobody else's. */
  storyArchive(page = 1, pageSize = 24): Observable<Page<Story>> {
    return this.http.get<Page<Story>>(`${this.base}/highlights/archive`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  deletePost(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/posts/${id}`);
  }

  like(id: number): Observable<LikeResult> {
    return this.http.post<LikeResult>(`${this.base}/posts/${id}/like`, {});
  }

  unlike(id: number): Observable<LikeResult> {
    return this.http.delete<LikeResult>(`${this.base}/posts/${id}/like`);
  }

  save(id: number): Observable<SaveResult> {
    return this.http.post<SaveResult>(`${this.base}/posts/${id}/save`, {});
  }

  unsave(id: number): Observable<SaveResult> {
    return this.http.delete<SaveResult>(`${this.base}/posts/${id}/save`);
  }

  /** Leave `collectionId` off for everything saved; pass one to read a single folder. */
  saved(page = 1, pageSize = 12, collectionId: number | null = null): Observable<Page<Post>> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);

    if (collectionId !== null) {
      params = params.set('collectionId', collectionId);
    }

    return this.http.get<Page<Post>>(`${this.base}/users/me/saved`, { params });
  }

  likedBy(id: number, page = 1): Observable<Page<UserSummary>> {
    return this.http.get<Page<UserSummary>>(`${this.base}/posts/${id}/likes`, {
      params: new HttpParams().set('page', page),
    });
  }

  comments(id: number, page = 1, pageSize = 20): Observable<Page<Comment>> {
    return this.http.get<Page<Comment>>(`${this.base}/posts/${id}/comments`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  /** `parentId` turns the comment into a reply. Threading stops at one level. */
  addComment(id: number, text: string, parentId?: number | null): Observable<Comment> {
    return this.http.post<Comment>(`${this.base}/posts/${id}/comments`, { text, parentId: parentId ?? null });
  }

  deleteComment(commentId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/posts/comments/${commentId}`);
  }

  likeComment(commentId: number): Observable<LikeResult> {
    return this.http.post<LikeResult>(`${this.base}/posts/comments/${commentId}/like`, {});
  }

  unlikeComment(commentId: number): Observable<LikeResult> {
    return this.http.delete<LikeResult>(`${this.base}/posts/comments/${commentId}/like`);
  }

  /** Anything left undefined is left as it is on the post. */
  updateCaption(
    id: number,
    caption: string,
    location: string,
    options: { commentsDisabled?: boolean; hideCounts?: boolean } = {},
  ): Observable<Post> {
    return this.http.put<Post>(`${this.base}/posts/${id}`, {
      caption,
      location,
      commentsDisabled: options.commentsDisabled ?? null,
      hideCounts: options.hideCounts ?? null,
    });
  }

  // --------------------------------------------------------------------- users

  profile(username: string): Observable<Profile> {
    return this.http.get<Profile>(`${this.base}/users/${username}`);
  }

  userPosts(username: string, page = 1, pageSize = 12): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/users/${username}/posts`, {
      params: new HttpParams().set('page', page).set('pageSize', pageSize),
    });
  }

  /** Each row carries how you stand with that account, so the button never has to guess. */
  followers(username: string, page = 1): Observable<Page<UserRelation>> {
    return this.http.get<Page<UserRelation>>(`${this.base}/users/${username}/followers`, {
      params: new HttpParams().set('page', page),
    });
  }

  following(username: string, page = 1): Observable<Page<UserRelation>> {
    return this.http.get<Page<UserRelation>>(`${this.base}/users/${username}/following`, {
      params: new HttpParams().set('page', page),
    });
  }

  /** Accounts they follow who follow them back — the intersection of the two directions. */
  friends(username: string, page = 1): Observable<Page<UserRelation>> {
    return this.http.get<Page<UserRelation>>(`${this.base}/users/${username}/friends`, {
      params: new HttpParams().set('page', page),
    });
  }

  follow(username: string): Observable<FollowResult> {
    return this.http.post<FollowResult>(`${this.base}/users/${username}/follow`, {});
  }

  unfollow(username: string): Observable<FollowResult> {
    return this.http.delete<FollowResult>(`${this.base}/users/${username}/follow`);
  }

  /** Removes somebody who follows you — deleting their edge to you, from your end. */
  removeFollower(username: string): Observable<FollowResult> {
    return this.http.delete<FollowResult>(`${this.base}/users/${username}/follower`);
  }

  block(username: string): Observable<Relationship> {
    return this.http.post<Relationship>(`${this.base}/users/${username}/block`, {});
  }

  unblock(username: string): Observable<Relationship> {
    return this.http.delete<Relationship>(`${this.base}/users/${username}/block`);
  }

  mute(username: string): Observable<Relationship> {
    return this.http.post<Relationship>(`${this.base}/users/${username}/mute`, {});
  }

  unmute(username: string): Observable<Relationship> {
    return this.http.delete<Relationship>(`${this.base}/users/${username}/mute`);
  }

  blocked(): Observable<UserSummary[]> {
    return this.http.get<UserSummary[]>(`${this.base}/users/me/blocked`);
  }

  /** Muting is invisible everywhere else by design, so it needs a list of its own. */
  muted(): Observable<UserSummary[]> {
    return this.http.get<UserSummary[]>(`${this.base}/users/me/muted`);
  }

  suggestions(limit = 6): Observable<SuggestedUser[]> {
    return this.http.get<SuggestedUser[]>(`${this.base}/users/suggestions`, {
      params: new HttpParams().set('limit', limit),
    });
  }

  search(q: string): Observable<SearchResults> {
    return this.http.get<SearchResults>(`${this.base}/users/search`, {
      params: new HttpParams().set('q', q),
    });
  }

  updateProfile(body: { fullName: string; bio: string; isPrivate: boolean }): Observable<Profile> {
    return this.http.put<Profile>(`${this.base}/users/me`, body);
  }

  updateAvatar(file: File): Observable<UserSummary> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<UserSummary>(`${this.base}/users/me/avatar`, form);
  }

  followRequests(): Observable<UserSummary[]> {
    return this.http.get<UserSummary[]>(`${this.base}/users/follow-requests`);
  }

  respondToRequest(username: string, accept: boolean): Observable<void> {
    const action = accept ? 'accept' : 'reject';
    return this.http.post<void>(`${this.base}/users/follow-requests/${username}/${action}`, {});
  }

  // --------------------------------------------------------------------- graph

  /**
   * The blended ranking, with the whole derivation attached. Pass a category to read one tab of the
   * discover screen instead of the mixed list.
   */
  graphSuggestions(limit = 12, category?: SuggestionCategory | 'all'): Observable<SuggestedUser[]> {
    let params = new HttpParams().set('limit', limit);

    if (category && category !== 'all') {
      params = params.set('category', category);
    }

    return this.http.get<SuggestedUser[]>(`${this.base}/graph/suggestions`, { params });
  }

  /** The shortest route from you to somebody else, with the accounts in between named. */
  connectionPath(username: string): Observable<ConnectionPath> {
    return this.http.get<ConnectionPath>(`${this.base}/graph/path/${username}`);
  }

  /** Your neighbourhood as nodes and edges, ready to draw. */
  network(depth = 2, limit = 90): Observable<NetworkGraph> {
    return this.http.get<NetworkGraph>(`${this.base}/graph/network`, {
      params: new HttpParams().set('depth', depth).set('limit', limit),
    });
  }

  /** Where you sit in the graph: reach, reciprocity, clustering, community, influence. */
  networkStats(): Observable<NetworkStats> {
    return this.http.get<NetworkStats>(`${this.base}/graph/stats`);
  }

  /**
   * Has the graph changed? A hash of the edge set and the counts behind it — cheap enough to poll,
   * because it forces none of the whole-graph passes on the server.
   */
  graphVersion(): Observable<GraphVersion> {
    return this.http.get<GraphVersion>(`${this.base}/graph/version`);
  }

  /** The full list behind the "Followed by …" line. */
  mutuals(username: string, page = 1): Observable<Page<UserRelation>> {
    return this.http.get<Page<UserRelation>>(`${this.base}/graph/mutuals/${username}`, {
      params: new HttpParams().set('page', page),
    });
  }

  // ------------------------------------------------------------------ hashtags

  trending(limit = 8): Observable<Hashtag[]> {
    return this.http.get<Hashtag[]>(`${this.base}/hashtags/trending`, {
      params: new HttpParams().set('limit', limit),
    });
  }

  hashtagPosts(tag: string, page = 1): Observable<Page<Post>> {
    return this.http.get<Page<Post>>(`${this.base}/hashtags/${tag}/posts`, {
      params: new HttpParams().set('page', page),
    });
  }

  // ------------------------------------------------------------- notifications

  notifications(page = 1): Observable<Page<Notification>> {
    return this.http.get<Page<Notification>>(`${this.base}/notifications`, {
      params: new HttpParams().set('page', page),
    });
  }

  unreadCount(): Observable<number> {
    return this.http.get<number>(`${this.base}/notifications/unread-count`);
  }

  markAllRead(): Observable<void> {
    return this.http.post<void>(`${this.base}/notifications/read-all`, {});
  }

  // ------------------------------------------------------------------ messages

  /** `folder` is inbox, requests or spam — three views of the same table. */
  inbox(folder: 'inbox' | 'requests' | 'spam' = 'inbox', page = 1, pageSize = 20): Observable<Page<Conversation>> {
    return this.http.get<Page<Conversation>>(`${this.base}/messages`, {
      params: new HttpParams().set('folder', folder).set('page', page).set('pageSize', pageSize),
    });
  }

  /** Unread threads and waiting requests, for the badge. */
  inboxCounts(): Observable<InboxCounts> {
    return this.http.get<InboxCounts>(`${this.base}/messages/counts`);
  }

  /** One thread. `before` pages backwards through the history. */
  thread(conversationId: number, before?: number, take = 40): Observable<ConversationDetail> {
    let params = new HttpParams().set('take', take);
    if (before) params = params.set('before', before);

    return this.http.get<ConversationDetail>(`${this.base}/messages/${conversationId}`, { params });
  }

  /** Opens a chat without sending anything. Several usernames makes it a group. */
  startChat(usernames: string[], title?: string): Observable<Conversation> {
    return this.http.post<Conversation>(`${this.base}/messages`, { usernames, title: title ?? null });
  }

  sendMessage(
    conversationId: number,
    body: { text?: string; sharedPostId?: number; sharedUsername?: string; replyToMessageId?: number; isHeart?: boolean },
  ): Observable<ChatMessage> {
    return this.http.post<ChatMessage>(`${this.base}/messages/${conversationId}/messages`, {
      text: body.text ?? '',
      sharedPostId: body.sharedPostId ?? null,
      sharedUsername: body.sharedUsername ?? null,
      replyToMessageId: body.replyToMessageId ?? null,
      isHeart: body.isHeart ?? false,
    });
  }

  sendChatPhoto(conversationId: number, file: File): Observable<ChatMessage> {
    const form = new FormData();
    form.append('image', file);

    return this.http.post<ChatMessage>(`${this.base}/messages/${conversationId}/photo`, form);
  }

  /** One post into several chats at once — the share sheet behind the paper plane. */
  sharePost(postId: number, usernames: string[], text = ''): Observable<{ sent: number }> {
    return this.http.post<{ sent: number }>(`${this.base}/messages/share`, { postId, usernames, text });
  }

  unsendMessage(messageId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/messages/messages/${messageId}`);
  }

  reactToMessage(messageId: number, emoji: string): Observable<ReactionSummary[]> {
    return this.http.post<ReactionSummary[]>(`${this.base}/messages/messages/${messageId}/react`, { emoji });
  }

  markChatRead(conversationId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/messages/${conversationId}/read`, {});
  }

  /** Held in memory on the server for a few seconds; never written down. */
  setTyping(conversationId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/messages/${conversationId}/typing`, {});
  }

  acceptChat(conversationId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/messages/${conversationId}/accept`, {});
  }

  declineChat(conversationId: number, spam = false): Observable<void> {
    return this.http.post<void>(`${this.base}/messages/${conversationId}/decline`, {}, {
      params: new HttpParams().set('spam', spam),
    });
  }

  updateChat(conversationId: number, body: { isMuted?: boolean; isPinned?: boolean }): Observable<void> {
    return this.http.put<void>(`${this.base}/messages/${conversationId}`, {
      isMuted: body.isMuted ?? null,
      isPinned: body.isPinned ?? null,
    });
  }

  deleteChat(conversationId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/messages/${conversationId}`);
  }

  leaveChat(conversationId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/messages/${conversationId}/leave`, {});
  }

  /** Who to offer on the new-message screen, ordered by the weight on the edge between you. */
  chatCandidates(q = '', limit = 20): Observable<ChatCandidate[]> {
    let params = new HttpParams().set('limit', limit);
    if (q) params = params.set('q', q);

    return this.http.get<ChatCandidate[]>(`${this.base}/messages/candidates`, { params });
  }

  // ------------------------------------------------------------------- stories

  /** The ring row: yours first, then anybody with something you have not opened. */
  storyTray(): Observable<StoryTray[]> {
    return this.http.get<StoryTray[]>(`${this.base}/stories`);
  }

  /** One account's live stories, oldest first — the order the viewer plays them in. */
  storiesOf(username: string): Observable<StoryTray> {
    return this.http.get<StoryTray>(`${this.base}/stories/${username}`);
  }

  postStory(image: File, caption: string, closeFriendsOnly: boolean): Observable<Story> {
    const form = new FormData();
    form.append('image', image);
    form.append('caption', caption);
    form.append('closeFriendsOnly', String(closeFriendsOnly));

    return this.http.post<Story>(`${this.base}/stories`, form);
  }

  markStorySeen(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/stories/${id}/view`, {});
  }

  /** Only the author may ask. */
  storyViewers(id: number): Observable<StoryViewer[]> {
    return this.http.get<StoryViewer[]>(`${this.base}/stories/${id}/viewers`);
  }

  /** Answering a story is an ordinary direct message that carries the story it answers. */
  replyToStory(id: number, text: string): Observable<ChatMessage> {
    return this.http.post<ChatMessage>(`${this.base}/stories/${id}/reply`, { text });
  }

  deleteStory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/stories/${id}`);
  }

  // --------------------------------------------------------------------- notes

  notes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.base}/notes`);
  }

  writeNote(text: string, closeFriendsOnly: boolean): Observable<Note> {
    return this.http.post<Note>(`${this.base}/notes`, { text, closeFriendsOnly });
  }

  clearNote(): Observable<void> {
    return this.http.delete<void>(`${this.base}/notes`);
  }

  // ------------------------------------------------------------------ settings

  settings(): Observable<Settings> {
    return this.http.get<Settings>(`${this.base}/settings`);
  }

  updateSettings(body: Omit<Settings, 'closeFriendCount' | 'favoriteCount' | 'blockedCount' | 'mutedCount'>): Observable<Settings> {
    return this.http.put<Settings>(`${this.base}/settings`, body);
  }

  activitySummary(): Observable<ActivitySummary> {
    return this.http.get<ActivitySummary>(`${this.base}/settings/activity`);
  }

  /** Close friends comes off your followers; favourites off the accounts you follow. */
  userList(kind: 'close-friends' | 'favorites', page = 1): Observable<Page<ListMember>> {
    return this.http.get<Page<ListMember>>(`${this.base}/settings/lists/${kind}`, {
      params: new HttpParams().set('page', page),
    });
  }

  setListEntry(kind: 'close-friends' | 'favorites', username: string, on: boolean): Observable<{ count: number }> {
    const url = `${this.base}/settings/lists/${kind}/${username}`;
    return on
      ? this.http.post<{ count: number }>(url, {})
      : this.http.delete<{ count: number }>(url);
  }
}
