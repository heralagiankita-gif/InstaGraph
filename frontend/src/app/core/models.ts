/** Mirrors the DTOs the API returns. Nothing here is guessed at from a component. */

export interface UserSummary {
  id: number;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
  /** The blue tick. Drawn next to the username wherever one appears. */
  isVerified: boolean;
}

/**
 * A person plus how the signed-in account stands with them.
 *
 * A follow is a directed edge, so "are we connected" has four answers rather than two: neither edge,
 * mine only, theirs only, or both. Anything that renders a follow button needs all four, otherwise it
 * will offer to follow somebody you are already friends with.
 */
export interface UserRelation extends UserSummary {
  isMe: boolean;
  /** An accepted edge from you to them. */
  isFollowing: boolean;
  /** Your request to their private account is still waiting. */
  followRequested: boolean;
  /** An accepted edge from them to you. */
  followsYou: boolean;
  /** Their request is waiting on your private account. */
  requestedYou: boolean;
  /** Both edges exist. */
  isFriend: boolean;
}

/** Which graph signal did the most work to produce a suggestion. */
export type SuggestionCategory =
  | 'FollowsYou'
  | 'MutualFriends'
  | 'PopularInCircle'
  | 'ExtendedNetwork'
  | 'SameCommunity'
  | 'Popular';

/** One row of the score breakdown behind a suggestion. */
export interface SignalBreakdown {
  name: string;
  /** The normalised reading, 0 to 1. */
  value: number;
  /** What it added to — or, when negative, took off — the final score. */
  contribution: number;
}

export interface SuggestedUser extends UserRelation {
  reason: string;
  mutualCount: number;
  category: SuggestionCategory;
  categoryLabel: string;
  score: number;
  /** Hops along the shortest route, or -1 when nothing links you inside four hops. */
  distance: number;
  followerCount: number;
  /** The accounts the recommendation actually came through. */
  via: UserSummary[];
  signals: SignalBreakdown[];
}

/** The route between you and another account, straight off the breadth-first search. */
export interface ConnectionPath {
  connected: boolean;
  degrees: number;
  path: UserSummary[];
  summary: string;
  mutualCount: number;
  followsYou: boolean;
  isFollowing: boolean;
  sameCommunity: boolean;
  similarity: number;
}

export interface NetworkNode extends UserSummary {
  /** 0 is you, 1 is somebody you follow, 2 is somebody they follow. */
  hop: number;
  community: number;
  /** PageRank, normalised against the largest node in this drawing. */
  influence: number;
  followerCount: number;
  isYou: boolean;
  isFollowing: boolean;
  followsYou: boolean;
}

export interface NetworkEdge {
  source: number;
  target: number;
  weight: number;
  mutual: boolean;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  communityCount: number;
  truncated: boolean;
}

export interface NetworkStats {
  following: number;
  followers: number;
  mutual: number;
  reach1: number;
  reach2: number;
  reach3: number;
  reciprocity: number;
  clustering: number;
  communitySize: number;
  influencePercentile: number;
  graphNodes: number;
  graphEdges: number;
  graphCommunities: number;
  graphVersion: string;
  snapshotBuiltAt: string;
}

/**
 * The answer to "has the graph changed?" — a content hash of the edge set plus the counts behind it.
 *
 * `builtAt` deliberately is not the change marker: it moves every time the server's twenty-second cache
 * expires, whether anything changed or not. `version` only moves when the edges do.
 */
export interface GraphVersion {
  version: string;
  nodes: number;
  edges: number;
  blocks: number;
  builtAt: string;
}

export interface Profile extends UserRelation {
  bio: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  /** How many of their edges run both ways. */
  friendCount: number;
  isLocked: boolean;
  isBlocked: boolean;
  isBlockedBy: boolean;
  isMuted: boolean;
  mutualFollowers: UserSummary[];
  mutualFollowerCount: number;
}

export interface Comment {
  id: number;
  author: UserSummary;
  text: string;
  isMine: boolean;
  createdAt: string;
  parentId: number | null;
  likeCount: number;
  isLiked: boolean;
  replyCount: number;
  replies: Comment[];
}

export interface Relationship {
  isBlocked: boolean;
  isMuted: boolean;
  isFollowing: boolean;
}

/** One photo or clip on a post, and its place in the run. */
export interface PostMedia {
  kind: 'Image' | 'Video';
  url: string;
  /** The still drawn before a clip plays. Null on a photo. */
  posterUrl: string | null;
  position: number;
  /** Width ÷ height, so the space is the right shape before the file arrives. */
  aspectRatio: number;
  durationMs: number;
}

/** Somebody named in the photo itself, and where on it their label sits. */
export interface PostTag {
  user: UserSummary;
  mediaPosition: number;
  /** 0–1 across and down, so the label survives any render size. */
  x: number;
  y: number;
}

export interface Post {
  id: number;
  author: UserSummary;
  /** The cover. What a grid cell or a share card draws without loading the run. */
  imageUrl: string;
  /** Everything on the post, in the author's order. Always at least one item. */
  media: PostMedia[];
  caption: string;
  location: string | null;
  /** A video post. Also appears in the vertical reels feed. */
  isReel: boolean;
  likeCount: number;
  commentCount: number;
  /** Plays, counted once per viewer. Shown on a reel in place of the like count. */
  viewCount: number;
  isLiked: boolean;
  isSaved: boolean;
  isMine: boolean;
  /** The author closed this one post to comments. */
  commentsDisabled: boolean;
  /** The author hid the numbers on this one post. They still see them themselves. */
  hideCounts: boolean;
  isPinned: boolean;
  /** Only ever true on your own posts. */
  isArchived: boolean;
  tags: PostTag[];
  /**
   * Whether you follow the author, where the API worked it out. Null means it did not, and nothing
   * should draw a follow button: a directed edge has four states, and false is a guess at one of them.
   */
  authorIsFollowed: boolean | null;
  hashtags: string[];
  createdAt: string;
  suggestedReason: string | null;
  previewComments: Comment[];
}

/** A folder inside the saved tab. */
export interface Collection {
  id: number;
  name: string;
  coverUrl: string | null;
  itemCount: number;
  createdAt: string;
}

export interface Notification {
  id: number;
  kind: 'Like' | 'Comment' | 'Follow' | 'FollowRequest' | 'Mention' | 'Reply' | 'CommentLike' | 'Tag';
  actor: UserSummary;
  postId: number | null;
  postImageUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface Hashtag {
  tag: string;
  postCount: number;
}

export interface SearchResults {
  users: UserSummary[];
  hashtags: Hashtag[];
}

export interface Page<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: UserSummary;
}

/** What `POST /auth/signup/start` answers with. */
export interface SendCodeResult {
  email: string;
  expiresAt: string;

  /** How long before another code may be asked for. */
  resendInSeconds: number;

  /**
   * False when the API has no SMTP server configured, which means the code went to its log rather than
   * to an inbox. The screen says so instead of leaving somebody waiting.
   */
  delivered: boolean;

  /** Present only on a development API with no mail configured — see the same field on the server. */
  devCode: string | null;
}

export interface VerifyCodeResult {
  /** Single-use proof that the address was confirmed. Spent by register; not a session. */
  verificationToken: string;
  expiresAt: string;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason: string | null;
  suggestions: string[];
}

/** Register hands back a name, not a token: the new account logs in for itself. */
export interface RegisteredResult {
  username: string;
  email: string;
}

/**
 * What `POST /auth/password/forgot` answers with — the same shape whether or not an account matched.
 *
 * <p>
 * The server will not say which usernames exist, so neither does this: `devCode` simply does not come
 * back when nothing matched, which on a machine with no mail server is the only visible difference and
 * is a development-only field anyway.
 * </p>
 */
export interface PasswordResetStarted {
  /** `an•••a@g•••.com` — recognisable to its owner, useless to anybody else. */
  maskedEmail: string;
  expiresAt: string;
  resendInSeconds: number;
  delivered: boolean;
  devCode?: string | null;
}

/**
 * What comes back after a password moves, by either route.
 *
 * <p>
 * The token matters: changing a password ends every session issued before it, including the one that
 * asked, so the replacement travels with the answer. Without storing it the app would sign itself out
 * the moment it succeeded.
 * </p>
 */
export interface PasswordChangedResult {
  token: string;
  expiresAt: string;
  user: UserSummary;
  otherSessionsEnded: boolean;
}

export interface LikeResult {
  isLiked: boolean;
  likeCount: number;
}

export interface SaveResult {
  isSaved: boolean;
}

/**
 * A named group of stories kept on a profile after the day they were posted.
 *
 * Not to be confused with {@link Highlight}, which is the ring row across the top of the feed. This one
 * is the circle under somebody's bio.
 */
export interface StoryHighlight {
  id: number;
  title: string;
  coverUrl: string | null;
  storyCount: number;
  isMine: boolean;
  createdAt: string;
  /** Empty on the profile listing; filled in only when one is opened. */
  stories: Story[];
}

/** One ring in the row across the top of the feed. */
export interface Highlight {
  user: UserSummary;
  latestPostId: number;
  latestImageUrl: string;
  postedAt: string;
}

export interface FollowResult {
  isFollowing: boolean;
  followRequested: boolean;
  followerCount: number;
}

/* -------------------------------------------------------------------- messages */

/** Somebody in a chat, plus whether they are around right now. */
export interface ChatParticipant extends UserSummary {
  /** Active in the last minute. Always false if either side has activity status off. */
  isOnline: boolean;
  lastActiveAt: string | null;
}

export type ConversationState = 'Accepted' | 'Pending' | 'Spam';

/** One row of the inbox. */
export interface Conversation {
  id: number;
  isGroup: boolean;
  title: string;
  participants: ChatParticipant[];
  preview: string;
  lastMessageAt: string | null;
  unreadCount: number;
  lastMessageSeen: boolean;
  lastMessageMine: boolean;
  isMuted: boolean;
  isPinned: boolean;
  state: ConversationState;
  isTyping: boolean;
  /** Their live note, when they have written one you are allowed to see. */
  note: string | null;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  users: UserSummary[];
}

export type MessageKind =
  | 'Text'
  | 'Image'
  | 'PostShare'
  | 'ProfileShare'
  | 'Heart'
  | 'System'
  | 'StoryReply';

export interface MessageQuote {
  id: number;
  author: string;
  preview: string;
  isUnsent: boolean;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  sender: UserSummary;
  kind: MessageKind;
  text: string;
  imageUrl: string | null;
  sharedPost: Post | null;
  sharedUser: UserSummary | null;
  /** The story this answers, or null once it has expired. The text survives either way. */
  sharedStory: Story | null;
  replyTo: MessageQuote | null;
  isMine: boolean;
  isUnsent: boolean;
  createdAt: string;
  reactions: ReactionSummary[];
  /** Client-side only: set on a message that has been drawn but not yet acknowledged by the API. */
  pending?: boolean;
  /** Client-side only: the send failed and the bubble offers a retry. */
  failed?: boolean;
}

/**
 * Why somebody with no edge to you is in your inbox. Only carried on a one-to-one thread, and only
 * interesting on one you have not accepted.
 */
export interface ChatContext {
  followsYou: boolean;
  isFollowing: boolean;
  mutualCount: number;
  mutuals: UserSummary[];
  distance: number;
  followerCount: number;
  summary: string;
}

export interface ConversationDetail {
  id: number;
  isGroup: boolean;
  title: string;
  participants: ChatParticipant[];
  messages: ChatMessage[];
  hasMore: boolean;
  state: ConversationState;
  isMuted: boolean;
  isPinned: boolean;
  typingUsernames: string[];
  seenUpToMessageId: number | null;
  context: ChatContext | null;
}

export interface InboxCounts {
  unread: number;
  requests: number;
}

/** A line above the inbox that disappears after a day. */
export interface Note {
  user: UserSummary;
  text: string;
  closeFriendsOnly: boolean;
  isMine: boolean;
  createdAt: string;
  expiresAt: string;
}

/** Somebody worth messaging, ordered by the weight already on the edge between you. */
export interface ChatCandidate extends UserRelation {
  reason: string;
  hasThread: boolean;
  conversationId: number;
  isOnline: boolean;
}

/* -------------------------------------------------------------------- settings */

export type AudienceValue = 'Everyone' | 'Following' | 'Friends' | 'NoOne';

export interface Settings {
  isPrivate: boolean;
  messagesFrom: AudienceValue;
  commentsFrom: AudienceValue;
  showActivityStatus: boolean;
  showReadReceipts: boolean;
  hideLikeCounts: boolean;
  hiddenWords: string;
  closeFriendCount: number;
  favoriteCount: number;
  blockedCount: number;
  mutedCount: number;
}

/** A candidate for one of the two lists, marked with whether they are already on it. */
export interface ListMember extends UserRelation {
  onList: boolean;
}

export interface ActivitySummary {
  posts: number;
  likesGiven: number;
  commentsWritten: number;
  saved: number;
  messagesSent: number;
  conversations: number;
  following: number;
  followers: number;
  friends: number;
  joinedAt: string;
}

/* --------------------------------------------------------------------- stories */

/** One photo in somebody's story. */
export interface Story {
  id: number;
  author: UserSummary;
  imageUrl: string;
  caption: string;
  closeFriendsOnly: boolean;
  isMine: boolean;
  /** Already opened — a grey ring rather than the gradient. */
  isSeen: boolean;
  /** Only ever filled in for the author. Nobody else is told how many people looked. */
  viewCount: number;
  createdAt: string;
  expiresAt: string;
}

/** One ring in the row across the top of the feed. */
export interface StoryTray {
  user: UserSummary;
  storyCount: number;
  hasUnseen: boolean;
  isMine: boolean;
  previewUrl: string;
  latestAt: string;
  /** Everything of theirs you are allowed to see, oldest first. */
  stories: Story[];
}

/** Somebody who opened your story. Visible to the author and to nobody else. */
export interface StoryViewer {
  user: UserSummary;
  viewedAt: string;
  followsYou: boolean;
  isFollowing: boolean;
}
