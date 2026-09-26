import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from './avatar';
import { Chip } from './chip';
import { Icon } from './icon';
import { ThemedText } from './themed-text';

import { addComment, deleteComment, voteComment } from '@/api';
import { useSession } from '@/auth/session';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CommentType, IdeaComment } from '@/types/models';
import { timeAgo } from '@/utils/time';

const MAX_DEPTH = 10; // idea_comments.depth CHECK
const MAX_LENGTH = 512; // idea_comments.content

/** Text box with a comment-type picker. Used for top-level comments and inline replies. */
export function CommentComposer({
  ideaId,
  parentId,
  types,
  onDone,
  autoFocus,
}: {
  ideaId: string;
  parentId: string | null;
  types: CommentType[];
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [type, setType] = useState(types[0]?.id);
  const canSend = text.trim().length > 0 && !!type;

  const send = () => {
    if (!canSend) return;
    addComment(ideaId, parentId, type!, text.trim());
    setText('');
    onDone?.();
  };

  return (
    <View style={[styles.composer, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.types}>
        {types.map((t) => (
          <Chip
            key={t.id}
            label={t.label}
            color={t.id === type ? t.color : undefined}
            onPress={() => setType(t.id)}
          />
        ))}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={parentId ? 'Write a reply…' : 'Add a comment…'}
          placeholderTextColor={theme.textSecondary}
          maxLength={MAX_LENGTH}
          multiline
          autoFocus={autoFocus}
          style={[styles.input, { color: theme.text }]}
        />
        <Pressable onPress={send} disabled={!canSend} hitSlop={8} accessibilityLabel="Send">
          <Icon name="send" size={20} color={canSend ? theme.accent : theme.textSecondary} />
        </Pressable>
      </View>
      {text.length > MAX_LENGTH - 60 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
          {text.length}/{MAX_LENGTH}
        </ThemedText>
      )}
    </View>
  );
}

/** Threaded comments. Top level sorted by score, replies oldest first. */
export function CommentThread({ ideaId, comments, types }: { ideaId: string; comments: IdeaComment[]; types: CommentType[] }) {
  const children = new Map<string | null, IdeaComment[]>();
  for (const c of comments) {
    const parent = c.parent_id ?? null;
    const list = children.get(parent) ?? [];
    list.push(c);
    children.set(parent, list);
  }
  const byDate = (a: IdeaComment, b: IdeaComment) => (a.created_at ?? '').localeCompare(b.created_at ?? '');
  children.get(null)?.sort((a, b) => b.score - a.score || byDate(a, b));
  for (const [key, list] of children) {
    if (key !== null) list.sort(byDate);
  }
  const typeById = new Map(types.map((t) => [t.id, t]));

  return (
    <View style={styles.thread}>
      {(children.get(null) ?? []).map((c) => (
        <CommentNode key={c.id} comment={c} childrenOf={children} typeById={typeById} ideaId={ideaId} types={types} />
      ))}
    </View>
  );
}

function CommentNode({
  comment,
  childrenOf,
  typeById,
  ideaId,
  types,
}: {
  comment: IdeaComment;
  childrenOf: Map<string | null, IdeaComment[]>;
  typeById: Map<string, CommentType>;
  ideaId: string;
  types: CommentType[];
}) {
  const theme = useTheme();
  const myId = useSession().user?.id;
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);
  const replies = childrenOf.get(comment.id) ?? [];
  const type = typeById.get(comment.comment_type);
  const deleted = !!comment.deleted_at;

  const vote = (v: 1 | -1) => voteComment(comment.id, comment.viewer_vote === v ? 0 : v);

  return (
    <View style={styles.node}>
      <Pressable onPress={() => setCollapsed((c) => !c)} style={styles.meta}>
        <Pressable
          disabled={!comment.author}
          onPress={() => comment.author && router.push({ pathname: '/user/[id]', params: { id: comment.author.id } })}>
          <Avatar user={comment.author} size={22} />
        </Pressable>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.flexShrink}>
          {comment.author?.display_name ?? '[deleted]'}
        </ThemedText>
        {type && !deleted && <Chip label={type.label} color={type.color} />}
        <ThemedText type="small" themeColor="textSecondary" style={styles.small}>
          · {timeAgo(comment.created_at)}
          {collapsed && replies.length > 0 ? ` · ${replies.length} more` : ''}
        </ThemedText>
      </Pressable>

      {!collapsed && (
        <View style={[styles.body, { borderLeftColor: theme.border }]}>
          <ThemedText type="small" themeColor={deleted ? 'textSecondary' : 'text'} style={deleted && styles.italic}>
            {comment.content}
          </ThemedText>

          {!deleted && (
            <View style={styles.actions}>
              <Pressable onPress={() => vote(1)} hitSlop={6} accessibilityLabel="Upvote">
                <Icon name="up" size={16} color={comment.viewer_vote === 1 ? theme.accent : theme.textSecondary} />
              </Pressable>
              <ThemedText
                type="smallBold"
                style={{
                  color:
                    comment.viewer_vote === 1 ? theme.accent : comment.viewer_vote === -1 ? theme.danger : theme.textSecondary,
                }}>
                {comment.score}
              </ThemedText>
              <Pressable onPress={() => vote(-1)} hitSlop={6} accessibilityLabel="Downvote">
                <Icon name="down" size={16} color={comment.viewer_vote === -1 ? theme.danger : theme.textSecondary} />
              </Pressable>
              {comment.depth < MAX_DEPTH && (
                <Pressable onPress={() => setReplying((r) => !r)} style={styles.action} hitSlop={6}>
                  <Icon name="reply" size={14} color={theme.textSecondary} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Reply
                  </ThemedText>
                </Pressable>
              )}
              {!!myId && comment.author?.id === myId && (
                <Pressable onPress={() => deleteComment(comment.id)} hitSlop={6}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Delete
                  </ThemedText>
                </Pressable>
              )}
            </View>
          )}

          {replying && (
            <CommentComposer ideaId={ideaId} parentId={comment.id} types={types} onDone={() => setReplying(false)} autoFocus />
          )}

          {replies.map((r) => (
            <CommentNode key={r.id} comment={r} childrenOf={childrenOf} typeById={typeById} ideaId={ideaId} types={types} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { gap: Spacing.three },
  node: { gap: Spacing.one },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  flexShrink: { flexShrink: 1 },
  small: { fontSize: 12 },
  body: {
    marginLeft: 10,
    paddingLeft: Spacing.three,
    borderLeftWidth: 2,
    gap: Spacing.two,
  },
  italic: { fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  composer: { borderRadius: Spacing.three, padding: Spacing.two + 2, gap: Spacing.two },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  input: { flex: 1, fontSize: 15, minHeight: 36, maxHeight: 140, paddingVertical: Spacing.one },
  counter: { textAlign: 'right', fontSize: 12 },
});
