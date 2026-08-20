select * from __EFMigrationsHistory;
select * from Blocks;
select * from CommentLikes;
select * from Comments;
select * from Follows;
select * from Hashtags;
select * from Mutes;
select * from Notifications;
select * from PostHashtags;
select * from PostLikes;
select * from Posts;
select * from SavedPosts;
select * from Users;

-- messaging: the second graph
select * from Conversations;
select * from ConversationMembers;
select * from Messages;
select * from MessageReactions;

-- notes, close friends and favourites
select * from Notes;
select * from UserListEntries;

-- stories: the third audience
select * from Stories;
select * from StoryViews;

-- media: a post is a list of things to look at, not one column
select * from PostMedia;
select * from PostViews;

-- people named in a photo, as opposed to @mentioned under it
select * from PostTags;

-- what is kept: highlights over stories, collections over saves
select * from Highlights;
select * from HighlightStories;
select * from Collections;
