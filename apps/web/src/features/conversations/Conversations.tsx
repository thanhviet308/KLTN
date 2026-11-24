import { useCallback, useEffect, useRef, useState } from 'react';
import './conversation-actions.css';
import { acquireChatSocket } from '../../lib/realtime';
import * as api from '../../lib/api';
import { Chat } from '../chat/Chat';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import { presenceLabel, type Presence } from '../../hooks/usePresence';
import {
  applyCachedMessage,
  cachedHistory,
  clearConversationHistoryCache,
  loadRecentHistory,
} from '../../lib/chat-history-cache';
import {
  messageSummary,
  type History,
  type Message,
} from '../../lib/chat-model';
import { CallExperience, type StartCall } from '../calls/CallExperience';
import { playMessageSound } from '../../lib/notification-sounds';
import { SharedMediaDialog } from './SharedMediaDialog';
import { MoreHorizontal, Sparkles } from 'lucide-react';
import { GroupTools, MessageSearch } from '../workspace/WorkspacePanels';
import type { Peer, Page } from '../../lib/types';
import {
  conversationTitle,
  isIncomingMessageRequest,
  roles,
  visibleConversations,
  type Conversation,
  type ConversationCategory,
  type Member,
} from './types';
import { ActiveFriends, type FriendNote } from './ActiveFriends';
import { ConversationSummaryPanel } from './ConversationSummaryPanel';
import { ComposeForm } from './ComposeForm';
import { HeaderOverflowSheet } from './HeaderOverflowSheet';
import { ThreadListItem } from './ThreadListItem';
import { ConversationCustomization } from './ConversationCustomization';

export function Conversations({
  user,
  onExpired,
  active = true,
  recipient,
  presence = {},
  onUnreadCount,
  aiChatOpen = false,
  onToggleAiChat,
}: {
  user: api.User;
  onExpired: () => void;
  active?: boolean;
  recipient?: { id: string; key: number };
  presence?: Record<string, Presence>;
  onUnreadCount?: (count: number) => void;
  aiChatOpen?: boolean;
  onToggleAiChat?: () => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [workspacePanel, setWorkspacePanel] = useState<'search' | 'group'>();
  const [jumpTarget, setJumpTarget] = useState<{
    conversationId: string;
    messageId: string;
    token: number;
  }>();
  const jumpToken = useRef(0);
  const [directNames, setDirectNames] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation>();
  const [members, setMembers] = useState<Member[]>([]);
  const [sharedMessages, setSharedMessages] = useState<Message[]>([]);
  const [incomingNotice, setIncomingNotice] = useState<Message>();
  useEffect(() => {
    if (!incomingNotice) return;
    const timer = window.setTimeout(() => setIncomingNotice(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [incomingNotice]);
  const [mediaView, setMediaView] = useState<{
    id: string;
    type: 'image' | 'file';
  }>();
  const [muted, setMuted] = useState<Record<string, boolean>>(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(`chat-muted:${user.id}`) ?? '{}',
      );
      return stored && typeof stored === 'object' && !Array.isArray(stored)
        ? stored
        : {};
    } catch {
      return {};
    }
  });
  const mutedRef = useRef(muted);
  function toggleMute(id: string) {
    const next = { ...mutedRef.current, [id]: !mutedRef.current[id] };
    mutedRef.current = next;
    setMuted(next);
    try {
      localStorage.setItem(`chat-muted:${user.id}`, JSON.stringify(next));
    } catch {
      /* Keep working in memory when storage is unavailable. */
    }
  }
  const [friends, setFriends] = useState<Peer[]>([]);
  const [notes, setNotes] = useState<FriendNote[]>([]);
  const [messageRequests, setMessageRequests] = useState<
    {
      id: string;
      user: Peer;
      body?: string;
      createdAt?: string;
      direction?: 'incoming' | 'outgoing';
    }[]
  >([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsUnavailable, setFriendsUnavailable] = useState(false);
  const onlineFriends = friends
    .filter((peer) => presence[peer.id]?.online)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
  const [creating, setCreating] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setHeaderMenuOpen(false);
  }, [selected?.id]);
  function toggleWorkspacePanel(panel: 'search' | 'group') {
    if (showInfo) {
      setShowInfo(false);
      setWorkspacePanel(panel);
      return;
    }
    setWorkspacePanel((previous) => (previous === panel ? undefined : panel));
  }
  function toggleConversationInfo() {
    if (!selected) return;
    const next = !showInfo;
    setShowInfo(next);
    if (next) void run(() => detail(selected.id));
  }
  function requestJumpToMessage(
    targetConversationId: string,
    messageId: string,
  ) {
    jumpToken.current += 1;
    setWorkspacePanel(undefined);
    setCreating(false);
    setShowInfo(false);
    setConfirmation(undefined);
    setJumpTarget({
      conversationId: targetConversationId,
      messageId,
      token: jumpToken.current,
    });
    if (selected?.id !== targetConversationId) {
      const existing = items.find((item) => item.id === targetConversationId);
      if (existing) {
        setSelected(existing);
        setMembers(
          existing.peer
            ? [
                { id: user.id, user, role: 'member' },
                { id: existing.peer.id, user: existing.peer, role: 'member' },
              ]
            : [],
        );
        if (existing.type === 'group')
          void detail(targetConversationId).catch(fail);
      } else {
        void run(() => detail(targetConversationId));
      }
    }
  }
  const [filter, setFilter] = useState('');
  const [searchedMessages, setSearchedMessages] = useState<
    Pick<
      Message,
      'id' | 'conversationId' | 'senderId' | 'body' | 'createdAt' | 'sequence'
    >[]
  >([]);
  const [searchedUsers, setSearchedUsers] = useState<Peer[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  useEffect(() => {
    const term = filter.trim();
    if (!term) {
      setSearchedMessages([]);
      setSearchedUsers([]);
      setSearchingMessages(false);
      return;
    }
    let cancelled = false;
    setSearchingMessages(true);
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ query: term, limit: '10' });
      const msgSearch = api
        .authenticated<{
          items: Pick<
            Message,
            | 'id'
            | 'conversationId'
            | 'senderId'
            | 'body'
            | 'createdAt'
            | 'sequence'
          >[];
        }>(`/messages/search?${params}`)
        .then((res) => {
          if (!cancelled) setSearchedMessages(res.items);
        })
        .catch(() => {
          if (!cancelled) setSearchedMessages([]);
        });
      const peopleSearch =
        term.length >= 2
          ? api
              .authenticated<{ items: ({ user: Peer } | Peer)[] }>(
                `/users?query=${encodeURIComponent(term)}&limit=8`,
              )
              .then((res) => {
                if (!cancelled) {
                  setSearchedUsers(
                    res.items.map((item) =>
                      'user' in item ? item.user : item,
                    ),
                  );
                }
              })
              .catch(() => {
                if (!cancelled) setSearchedUsers([]);
              })
          : Promise.resolve().then(() => {
              if (!cancelled) setSearchedUsers([]);
            });
      void Promise.all([msgSearch, peopleSearch]).finally(() => {
        if (!cancelled) setSearchingMessages(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter]);
  const [category, setCategory] = useState<ConversationCategory>('all');
  const [friendFilter, setFriendFilter] = useState('');
  const matchingFriends = friends.filter((peer) =>
    peer.displayName
      .toLocaleLowerCase('vi')
      .includes(friendFilter.toLocaleLowerCase('vi').trim()),
  );
  const [listLoading, setListLoading] = useState(true);
  const [type, setType] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [invite, setInvite] = useState('');
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function applyCustomization(conversation: Conversation) {
    const merge = (previous: Conversation): Conversation => {
      if (
        previous.id !== conversation.id ||
        Date.parse(previous.updatedAt ?? previous.createdAt) >
          Date.parse(conversation.updatedAt ?? conversation.createdAt)
      )
        return previous;
      return {
        ...previous,
        background: conversation.background,
        nicknames: conversation.nicknames,
        messageRequest: conversation.messageRequest,
        updatedAt: conversation.updatedAt,
      };
    };
    setSelected((previous) => (previous ? merge(previous) : previous));
    setItems((previous) => previous.map(merge));
  }
  useEffect(() => {
    if (!active || !selected?.id || busy) return;
    const id = selected.id;
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      try {
        const result = await api.authenticated<{ conversation: Conversation }>(
          `/conversations/${id}`,
        );
        if (!cancelled) applyCustomization(result.conversation);
      } catch {
        // Existing conversation/message flows handle session and access errors.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [active, selected?.id, busy]);
  const [confirmation, setConfirmation] = useState<{
    text: string;
    path: string;
    body?: unknown;
    method: string;
    leave?: boolean;
    clearHistory?: boolean;
  }>();
  const requestKey = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const live = useRef(true);
  const readVersion = useRef(0);
  const listVersion = useRef(0);
  const listRequests = useRef(0);
  const transientListError = useRef(false);
  const handledRecipient = useRef<number | undefined>(undefined);
  const callStart = useRef<StartCall | undefined>(undefined);
  const conversationIds = useRef<string[]>([]);
  const selectedId = useRef<string | undefined>(undefined);
  const viewActive = useRef(active);
  conversationIds.current = items.slice(0, 50).map((item) => item.id);
  selectedId.current = selected?.id;
  viewActive.current = active;
  const totalUnread = items
    .filter((item) => !isIncomingMessageRequest(item))
    .reduce((total, item) => total + (item.unreadCount ?? 0), 0);
  useEffect(() => {
    onUnreadCount?.(totalUnread);
  }, [onUnreadCount, totalUnread]);
  const registerCallStart = useCallback((start: StartCall | undefined) => {
    callStart.current = start;
  }, []);
  function preload(id: string) {
    const key = `${user.id}:${id}`;
    if (cachedHistory(key)) return;
    void loadRecentHistory(key, () =>
      api.authenticated<History>(
        `/conversations/${id}/messages?direction=backward&limit=50`,
      ),
    ).catch(() => {});
  }
  function fail(e: unknown) {
    if (e instanceof api.ApiError && e.code === 'SESSION_CHANGED') return;
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else setError(api.errorMessage(e));
  }
  async function all<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    let next: string | null = null;
    do {
      const page: Page<T> = await api.authenticated(
        `${path}?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
      );
      result.push(...page.items);
      next = page.nextCursor;
    } while (next);
    return result;
  }
  async function list(next?: string, background = false) {
    if (background && listRequests.current) return;
    listRequests.current++;
    try {
      const version = ++listVersion.current;
      const page = await api.authenticated<Page<Conversation>>(
        `/conversations?limit=20${next ? `&cursor=${next}` : ''}`,
      );
      const names = page.items
        .filter((item) => item.type === 'direct')
        .map((item) => {
          return [
            item.id,
            item.peer?.displayName ?? 'Trò chuyện riêng',
          ] as const;
        });
      if (!live.current || version !== listVersion.current) return;
      setDirectNames((previous) => ({
        ...previous,
        ...Object.fromEntries(names),
      }));
      setItems((previous) => {
        if (!next && (!background || !page.nextCursor)) return page.items;
        return [
          ...previous.map(
            (old) => page.items.find((item) => item.id === old.id) ?? old,
          ),
          ...page.items.filter(
            (item) => !previous.some((old) => old.id === item.id),
          ),
        ];
      });
      setSelected((previous) => {
        if (!previous) return previous;
        const fresh = page.items.find((item) => item.id === previous.id);
        return fresh
          ? {
              ...previous,
              messageRequest: fresh.messageRequest,
              nicknames: fresh.nicknames ?? previous.nicknames,
              background: fresh.background ?? previous.background,
            }
          : previous;
      });
      if (!background) setCursor(page.nextCursor);
      setListLoading(false);
      if (transientListError.current) {
        transientListError.current = false;
        setError('');
      }
      if (!background && !next)
        page.items.slice(0, 4).forEach((item) => preload(item.id));
    } finally {
      listRequests.current--;
    }
  }
  async function detail(id: string) {
    const version = ++readVersion.current;
    const [result, people] = await Promise.all([
      api.authenticated<{ conversation: Conversation }>(`/conversations/${id}`),
      all<Member>(`/conversations/${id}/members`),
    ]);
    if (!live.current || version !== readVersion.current) return;
    setSelected({
      ...result.conversation,
      peer:
        result.conversation.type === 'direct'
          ? (people.find((member) => member.user.id !== user.id)?.user ?? null)
          : null,
    });
    setMembers(people);
    setRename(result.conversation.title ?? '');
  }
  async function run(work: () => Promise<void>, success = '') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (live.current) setNotice(success);
    } catch (e) {
      if (!live.current) return;
      fail(e);
      if (
        e instanceof api.ApiError &&
        e.status === 404 &&
        e.code === 'CONVERSATION_NOT_FOUND'
      ) {
        setSelected(undefined);
        setMembers([]);
        void list().catch(fail);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  function applyClearedHistoryState(
    conversationId: string,
    clearedAfterSequence: string,
  ) {
    const cutoff = BigInt(clearedAfterSequence || '0');
    clearConversationHistoryCache(`${user.id}:${conversationId}`);
    setItems((previous) =>
      previous.map((item) => {
        if (item.id !== conversationId) return item;
        const clearsPreview =
          item.lastMessage && BigInt(item.lastMessage.sequence) <= cutoff;
        return {
          ...item,
          membership: {
            ...item.membership,
            clearedAfterSequence,
          },
          lastMessage: clearsPreview ? null : item.lastMessage,
          unreadCount: 0,
        };
      }),
    );
    setSelected((previous) =>
      previous && previous.id === conversationId
        ? {
            ...previous,
            membership: {
              ...previous.membership,
              clearedAfterSequence,
            },
          }
        : previous,
    );
    setSearchedMessages((previous) =>
      previous.filter(
        (hit) =>
          hit.conversationId !== conversationId ||
          BigInt(hit.sequence) > cutoff,
      ),
    );
    if (selectedId.current === conversationId) {
      setSharedMessages((previous) =>
        previous.filter((message) => BigInt(message.sequence) > cutoff),
      );
    }
    setIncomingNotice((previous) =>
      previous?.conversationId === conversationId &&
      BigInt(previous.sequence) <= cutoff
        ? undefined
        : previous,
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('chat:history-cleared', {
          detail: { conversationId, clearedAfterSequence },
        }),
      );
    }
  }
  async function clearConversationHistory(conversationId: string) {
    await run(async () => {
      const result = await api.authenticated<{
        conversation: Conversation;
        clearedAfterSequence: string;
      }>(`/conversations/${conversationId}/history`, undefined, 'DELETE');
      applyClearedHistoryState(conversationId, result.clearedAfterSequence);
      setWorkspacePanel(undefined);
    }, 'Đã xóa lịch sử trò chuyện phía bạn.');
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      readVersion.current++;
      listVersion.current++;
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    const hub = acquireChatSocket(user.id);
    const client = hub.socket;
    const onAccountVisibility = ({
      userId,
      status,
    }: {
      userId: string;
      status: string;
    }) => {
      if (stopped) return;
      if (status === 'blocked')
        setSelected((old) =>
          old?.type === 'direct' && old.peer?.id === userId ? undefined : old,
        );
      void list(undefined, true).catch(() => {});
    };
    const onMessageCreated = (message: Message) => {
      if (stopped) return;
      applyCachedMessage(`${user.id}:${message.conversationId}`, message);
      const mine = message.senderId === user.id;
      const visibleConversation =
        viewActive.current &&
        selectedId.current === message.conversationId &&
        document.visibilityState === 'visible' &&
        document.hasFocus();
      setItems((previous) => {
        if (!previous.some((item) => item.id === message.conversationId))
          return previous;
        return previous
          .map((item) =>
            item.id === message.conversationId
              ? {
                  ...item,
                  messageRequest:
                    mine && item.messageRequest?.direction === 'incoming'
                      ? null
                      : item.messageRequest,
                  updatedAt: message.createdAt,
                  lastMessage: {
                    ...message,
                    body: message.body?.slice(0, 200) ?? null,
                    senderName:
                      item.type === 'direct'
                        ? item.peer?.displayName
                        : undefined,
                  },
                  unreadCount:
                    mine || visibleConversation
                      ? item.unreadCount
                      : (item.unreadCount ?? 0) + 1,
                }
              : item,
          )
          .sort(
            (left, right) =>
              Date.parse(right.updatedAt ?? right.createdAt) -
              Date.parse(left.updatedAt ?? left.createdAt),
          );
      });
      if (!mine && !mutedRef.current[message.conversationId]) {
        void playMessageSound();
        setIncomingNotice(message);
      }
      if (!conversationIds.current.includes(message.conversationId))
        void list(undefined, true).catch(() => {});
      if (!mine)
        void api
          .authenticated(
            `/conversations/${message.conversationId}/messages/delivered`,
            { messageId: message.id },
          )
          .catch(() => {});
    };
    const onHistoryCleared = (event: {
      conversationId: string;
      clearedAfterSequence: string;
    }) => {
      if (stopped) return;
      applyClearedHistoryState(
        event.conversationId,
        event.clearedAfterSequence,
      );
    };
    const onFriendsUpdated = () => {
      if (stopped) return;
      void loadFriends().catch(() => {});
      void list(undefined, true).catch(() => {});
    };
    client.on('account:visibility', onAccountVisibility);
    client.on('message:created', onMessageCreated);
    client.on('conversation:history-cleared', onHistoryCleared);
    client.on('friends:updated', onFriendsUpdated);
    return () => {
      stopped = true;
      client.off('account:visibility', onAccountVisibility);
      client.off('message:created', onMessageCreated);
      client.off('conversation:history-cleared', onHistoryCleared);
      client.off('friends:updated', onFriendsUpdated);
      hub.release();
    };
  }, [user.id]);
  useEffect(() => {
    if (!active) return;
    const refreshFriends = () => {
      void loadFriends().catch(() => {
        if (live.current) {
          setFriendsUnavailable(true);
          setFriendsLoading(false);
        }
      });
    };
    refreshFriends();
    const handleBackgroundListFailure = (failure: unknown) => {
      const isTransient =
        failure instanceof api.ApiError &&
        (failure.status === 0 || failure.status >= 500);
      if (isTransient && conversationIds.current.length > 0) return;
      if (isTransient) transientListError.current = true;
      fail(failure);
    };
    void list().catch((failure) => {
      setListLoading(false);
      handleBackgroundListFailure(failure);
    });
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void list(undefined, true).catch(handleBackgroundListFailure);
        refreshFriends();
      }
    };
    window.addEventListener('focus', refresh);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void list(undefined, true).catch(handleBackgroundListFailure);
        refreshFriends();
      }
    }, 30000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(interval);
    };
  }, [active]);
  useEffect(() => {
    if (!recipient || busy || handledRecipient.current === recipient.key)
      return;
    handledRecipient.current = recipient.key;
    void startDirect(recipient.id);
  }, [recipient?.key, busy]);
  const visibleThreads = visibleConversations(
    items,
    category,
    filter,
    directNames,
  );
  const matchingSidebarFriends = filter.trim()
    ? friends.filter(
        (peer) =>
          peer.displayName
            .toLocaleLowerCase('vi')
            .includes(filter.toLocaleLowerCase('vi').trim()) &&
          !visibleThreads.some(
            (thread) => thread.type === 'direct' && thread.peer?.id === peer.id,
          ),
      )
    : [];
  const matchingNonFriends = filter.trim()
    ? searchedUsers.filter(
        (peer) =>
          peer.id !== user.id &&
          !friends.some((f) => f.id === peer.id) &&
          !visibleThreads.some(
            (thread) => thread.type === 'direct' && thread.peer?.id === peer.id,
          ),
      )
    : [];
  const incomingThreadsCount = items.filter(isIncomingMessageRequest).length;
  const incomingRequestsApiCount = messageRequests.filter(
    (req) => req.direction !== 'outgoing',
  ).length;
  const incomingMessageRequestsCount = Math.max(
    incomingThreadsCount,
    incomingRequestsApiCount,
  );
  const fallbackIncomingRequests = messageRequests.filter(
    (req) =>
      req.direction !== 'outgoing' &&
      !items.some(
        (item) => item.type === 'direct' && item.peer?.id === req.user.id,
      ) &&
      req.user.displayName
        .toLocaleLowerCase('vi')
        .includes(filter.toLocaleLowerCase('vi').trim()),
  );
  const isGroup = selected?.type === 'group';
  const owner = isGroup && selected.membership.role === 'owner';
  const manager = isGroup && selected.membership.role !== 'member';
  const selectedPeer =
    selected?.type === 'direct'
      ? (items.find((item) => item.id === selected.id)?.peer ??
        selected.peer ??
        members.find((member) => member.user.id !== user.id)?.user)
      : undefined;
  const selectedLiveItem = selected
    ? items.find((item) => item.id === selected.id)
    : undefined;
  const selectedMessageRequest = selected
    ? selectedLiveItem && selectedLiveItem.messageRequest !== undefined
      ? selectedLiveItem.messageRequest
      : (selected.messageRequest ?? null)
    : null;
  const heading = selected
    ? selected.type === 'group'
      ? selected.title
      : ((selectedPeer && selected.nicknames?.[selectedPeer.id]) ??
        selectedPeer?.displayName ??
        'Trò chuyện riêng')
    : 'Hội thoại';
  async function loadFriends() {
    const [rows, notePage, reqPage] = await Promise.all([
      all<{ user: Peer }>('/friends'),
      api.authenticated<{ items: FriendNote[] }>('/notes'),
      api
        .authenticated<{
          items: {
            id: string;
            user: Peer;
            body?: string;
            createdAt?: string;
            direction?: 'incoming' | 'outgoing';
          }[];
        }>('/message-requests?direction=all&limit=20')
        .catch(() => ({ items: [] })),
    ]);
    if (live.current) {
      setFriends(rows.map((row) => row.user));
      setNotes(notePage.items);
      setMessageRequests(reqPage.items);
      setFriendsLoading(false);
      setFriendsUnavailable(false);
    }
  }
  async function create() {
    if (type === 'group' && title.trim().length > 200) {
      setError('Tên nhóm tối đa 200 ký tự.');
      return;
    }
    if (!chosen.length || (type === 'group' && chosen.length > 49)) {
      setError(
        type === 'direct'
          ? 'Chọn một người nhận để bắt đầu trò chuyện.'
          : 'Chọn từ 1 đến 49 người bạn để tạo nhóm.',
      );
      return;
    }
    const chosenNames = chosen
      .map((id) => friends.find((f) => f.id === id)?.displayName)
      .filter((n): n is string => !!n);
    const resolvedTitle =
      title.trim() ||
      [user.displayName, ...chosenNames]
        .filter(Boolean)
        .join(', ')
        .slice(0, 140) ||
      'Nhóm trò chuyện';

    await run(async () => {
      const fingerprint = JSON.stringify({
        title: resolvedTitle,
        memberIds: [...chosen].sort(),
      });
      if (!requestKey.current || requestKey.current.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, id: crypto.randomUUID() };
      const body =
        type === 'direct'
          ? { type, recipientId: chosen[0] }
          : {
              type,
              title: resolvedTitle,
              memberIds: chosen,
              clientRequestId: requestKey.current.id,
            };
      const result = await api.authenticated<{ conversation: Conversation }>(
        '/conversations',
        body,
      );
      setCreating(false);
      await Promise.all([list(), detail(result.conversation.id)]);
      requestKey.current = undefined;
    });
  }
  async function startDirect(recipientId: string) {
    await run(async () => {
      const result = await api.authenticated<{ conversation: Conversation }>(
        '/conversations',
        { type: 'direct', recipientId },
      );
      setCreating(false);
      setShowInfo(false);
      setConfirmation(undefined);
      await Promise.all([detail(result.conversation.id), list()]);
    });
  }
  function applyComposeMode(kind: 'direct' | 'group') {
    setType(kind);
    setChosen([]);
    setTitle('');
    setError('');
    setNotice('');
    requestKey.current = undefined;
  }
  function compose(kind: 'direct' | 'group') {
    applyComposeMode(kind);
    setCreating(true);
    setSelected(undefined);
    setShowInfo(false);
    setFriendFilter('');
    setConfirmation(undefined);
    void run(loadFriends);
  }

  async function acceptSelectedMessageRequest() {
    if (!selected) return;
    const reqId =
      selected.messageRequest?.id ??
      messageRequests.find((req) => req.user.id === selectedPeer?.id)?.id;
    await run(async () => {
      if (reqId) {
        await api.authenticated(
          `/message-requests/${reqId}`,
          { action: 'accept' },
          'PATCH',
        );
      }
      setSelected((prev) => (prev ? { ...prev, messageRequest: null } : prev));
      setItems((prev) =>
        prev.map((item) =>
          item.id === selected.id ? { ...item, messageRequest: null } : item,
        ),
      );
      setCategory('all');
      await Promise.all([loadFriends(), list(undefined, true)]);
    }, 'Đã chấp nhận tin nhắn chờ.');
  }

  async function rejectSelectedMessageRequest() {
    if (!selected) return;
    const targetConvId = selected.id;
    const reqId =
      selected.messageRequest?.id ??
      messageRequests.find((req) => req.user.id === selectedPeer?.id)?.id;
    await run(async () => {
      if (reqId) {
        await api.authenticated(
          `/message-requests/${reqId}`,
          { action: 'reject' },
          'PATCH',
        );
      } else {
        await api.authenticated(
          `/conversations/${targetConvId}/history`,
          undefined,
          'DELETE',
        );
      }
      setSelected(undefined);
      setItems((prev) => prev.filter((item) => item.id !== targetConvId));
      await Promise.all([loadFriends(), list(undefined, true)]);
    }, 'Đã xóa tin nhắn chờ.');
  }

  return (
    <section
      className={`conversations messenger-layout${selected || creating ? ' has-thread' : ''}${selected && !creating && !showInfo ? ' has-summary' : ''}`}
      aria-busy={busy}
    >
      <aside className="thread-sidebar" aria-label="Danh sách trò chuyện">
        <div className="thread-sidebar-heading">
          <h2>Đoạn chat</h2>
          <button
            type="button"
            className="secondary accept"
            aria-label="Tin nhắn mới hoặc tạo nhóm"
            title="Tin nhắn mới hoặc tạo nhóm"
            disabled={busy}
            onClick={() => compose(category === 'group' ? 'group' : 'direct')}
          >
            <UiIcon name="compose" />
          </button>
        </div>
        <div className="thread-search">
          <UiIcon name="search" size={18} />
          <input
            aria-label="Tìm cuộc trò chuyện, bạn bè và tin nhắn"
            placeholder="Tìm bạn bè, nhóm và tin nhắn…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <ActiveFriends
          loading={friendsLoading}
          unavailable={friendsUnavailable}
          online={onlineFriends}
          friends={friends}
          presence={presence}
          notes={notes}
          currentUser={user}
          hasFriends={friends.length > 0}
          presenceLoaded={Object.keys(presence).length > 0}
          busy={busy}
          onRetry={() => void run(loadFriends)}
          onOpen={(peerId) => void startDirect(peerId)}
          onNoteChange={(note) =>
            setNotes((previous) => [
              ...(note ? [note] : []),
              ...previous.filter((item) => item.user.id !== user.id),
            ])
          }
        />
        <div className="thread-filters" aria-label="Lọc đoạn chat">
          {(
            [
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['group', 'Nhóm'],
              ['requests', 'Tin nhắn chờ'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={
                key === 'requests'
                  ? `Tin nhắn chờ${incomingMessageRequestsCount > 0 ? `, ${incomingMessageRequestsCount} lời mời` : ''}`
                  : label
              }
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {key === 'requests' ? 'Chờ' : label}
              {key === 'requests' && incomingMessageRequestsCount > 0 && (
                <span className="thread-filter-badge">
                  {incomingMessageRequestsCount > 99
                    ? '99+'
                    : incomingMessageRequestsCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="thread-tools">
          <button
            className="retry"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await Promise.all([list(), loadFriends()]);
              })
            }
          >
            Tải lại
          </button>
        </div>
        {category === 'requests' ? (
          <>
            <ul className="thread-list">
              {visibleThreads.map((item) => (
                <ThreadListItem
                  key={item.id}
                  item={item}
                  currentUserId={user.id}
                  selected={selected?.id === item.id}
                  busy={busy}
                  directNames={directNames}
                  presence={presence}
                  onPreload={() => preload(item.id)}
                  onSelect={() => {
                    setSelected(item);
                    setMembers(
                      item.peer
                        ? [
                            { id: user.id, user, role: 'member' },
                            {
                              id: item.peer.id,
                              user: item.peer,
                              role: 'member',
                            },
                          ]
                        : [],
                    );
                    setCreating(false);
                    setShowInfo(false);
                    setConfirmation(undefined);
                  }}
                />
              ))}
              {fallbackIncomingRequests.map((req) => (
                <li key={req.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void startDirect(req.user.id)}
                  >
                    <span className="peer-avatar" aria-hidden="true">
                      <Avatar peer={req.user} />
                    </span>
                    <span className="thread-summary">
                      <strong>{req.user.displayName}</strong>
                      <div className="thread-preview-row">
                        <small>{req.body ?? 'Tin nhắn chờ mới'}</small>
                      </div>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {visibleThreads.length === 0 &&
              fallbackIncomingRequests.length === 0 && (
                <p className="list-status">
                  {filter
                    ? 'Không tìm thấy tin nhắn chờ phù hợp.'
                    : 'Chưa có tin nhắn chờ nào từ người lạ.'}
                </p>
              )}
          </>
        ) : (
          <>
            <ul className="thread-list">
              {visibleThreads.map((item) => (
                <ThreadListItem
                  key={item.id}
                  item={item}
                  currentUserId={user.id}
                  selected={selected?.id === item.id}
                  busy={busy}
                  directNames={directNames}
                  presence={presence}
                  onPreload={() => preload(item.id)}
                  onSelect={() => {
                    setSelected(item);
                    setMembers(
                      item.peer
                        ? [
                            { id: user.id, user, role: 'member' },
                            {
                              id: item.peer.id,
                              user: item.peer,
                              role: 'member',
                            },
                          ]
                        : [],
                    );
                    setCreating(false);
                    setShowInfo(false);
                    setConfirmation(undefined);
                    // Direct rows already contain the peer and membership.
                    if (item.type === 'group') void detail(item.id).catch(fail);
                  }}
                />
              ))}
            </ul>
            {matchingSidebarFriends.length > 0 && (
              <>
                <p className="workspace-search-heading">Bạn bè</p>
                <ul className="thread-list">
                  {matchingSidebarFriends.map((peer) => (
                    <li key={peer.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void startDirect(peer.id)}
                      >
                        <span className="peer-avatar presence-avatar">
                          {presence[peer.id]?.online && (
                            <span
                              className="presence-dot"
                              aria-label="Đang hoạt động"
                            />
                          )}
                          <Avatar peer={peer} />
                        </span>
                        <span className="thread-summary">
                          <strong>{peer.displayName}</strong>
                          <div className="thread-preview-row">
                            <small>
                              {presenceLabel(presence[peer.id]) ||
                                'Nhấn để bắt đầu trò chuyện'}
                            </small>
                          </div>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {matchingNonFriends.length > 0 && (
              <>
                <p className="workspace-search-heading">
                  Mọi người trên PingPong
                </p>
                <ul className="thread-list">
                  {matchingNonFriends.map((peer) => (
                    <li key={peer.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setFilter('');
                          void startDirect(peer.id);
                        }}
                      >
                        <span className="peer-avatar">
                          <Avatar peer={peer} />
                        </span>
                        <span className="thread-summary">
                          <strong>{peer.displayName}</strong>
                          <div className="thread-preview-row">
                            <small>Chưa kết bạn · Nhấn để nhắn tin</small>
                          </div>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {filter.trim() &&
              (searchingMessages || searchedMessages.length > 0) && (
                <>
                  <p className="workspace-search-heading">Tin nhắn phù hợp</p>
                  {searchingMessages && !searchedMessages.length && (
                    <p className="list-status" role="status">
                      Đang tìm tin nhắn…
                    </p>
                  )}
                  <ul className="thread-list">
                    {searchedMessages.map((hit) => {
                      const thread = items.find(
                        (item) => item.id === hit.conversationId,
                      );
                      const title = thread
                        ? conversationTitle(thread, directNames)
                        : (friends.find((f) => f.id === hit.senderId)
                            ?.displayName ?? 'Cuộc trò chuyện');
                      return (
                        <li key={hit.id}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              requestJumpToMessage(hit.conversationId, hit.id)
                            }
                          >
                            <span className="peer-avatar">
                              <Avatar
                                peer={
                                  thread?.peer ?? {
                                    displayName: title,
                                  }
                                }
                              />
                            </span>
                            <span className="thread-summary">
                              <strong>{title}</strong>
                              <div className="thread-preview-row">
                                <small>{hit.body}</small>
                              </div>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            {!listLoading &&
              items.length > 0 &&
              visibleThreads.length === 0 &&
              matchingSidebarFriends.length === 0 &&
              matchingNonFriends.length === 0 &&
              !searchingMessages &&
              searchedMessages.length === 0 && (
                <p className="list-status">
                  {filter
                    ? 'Không tìm thấy cuộc trò chuyện, bạn bè hay tin nhắn phù hợp.'
                    : category === 'unread'
                      ? 'Bạn đã đọc hết tin nhắn.'
                      : 'Chưa có cuộc trò chuyện nhóm.'}
                </p>
              )}
            {listLoading && !items.length && (
              <p className="list-status" role="status">
                Đang tải đoạn chat…
              </p>
            )}
            {!listLoading && !busy && !error && !items.length && (
              <p className="list-status">
                Chưa có đoạn chat. Chọn “Nhắn mới” để bắt đầu.
              </p>
            )}
            {cursor && (
              <button
                className="secondary load-more"
                disabled={busy}
                onClick={() => void run(() => list(cursor))}
              >
                Xem thêm
              </button>
            )}
          </>
        )}
      </aside>
      <div className="thread-content">
        <div className="conversation-toolbar">
          {(selected || creating) && (
            <button
              className="chat-back"
              type="button"
              aria-label="Trở về danh sách trò chuyện"
              onClick={() => {
                readVersion.current++;
                setSelected(undefined);
                setCreating(false);
                setShowInfo(false);
                setConfirmation(undefined);
                setError('');
                setNotice('');
              }}
            >
              ←
            </button>
          )}
          <h2>
            {selected ? (
              <button
                className="chat-heading"
                type="button"
                disabled={busy}
                aria-label="Xem thông tin cuộc trò chuyện"
                aria-expanded={showInfo}
                onClick={() => {
                  setShowInfo(!showInfo);
                  if (!showInfo) void run(() => detail(selected.id));
                }}
              >
                <span className="chat-header-avatar">
                  <Avatar
                    peer={selected.peer ?? { displayName: heading ?? 'Nhóm' }}
                  />
                </span>
                <span className="chat-header-title">
                  {heading}
                  <small>
                    {selected.type === 'group' ? (
                      'Trò chuyện nhóm'
                    ) : selectedPeer && presence[selectedPeer.id] ? (
                      <span
                        className={`presence-status${selectedPeer && presence[selectedPeer.id]?.online ? ' is-online' : ''}`}
                      >
                        <span aria-hidden="true" />
                        {presenceLabel(presence[selectedPeer.id])}
                      </span>
                    ) : null}
                  </small>
                </span>
              </button>
            ) : creating ? (
              type === 'direct' ? (
                'Tin nhắn mới'
              ) : (
                'Tạo nhóm'
              )
            ) : (
              'PingPong'
            )}
          </h2>
          {(selected || onToggleAiChat) && (
            <div className="chat-call-actions">
              {!selected && onToggleAiChat && (
                <button
                  type="button"
                  className="chat-info-button ai-toolbar-toggle"
                  title="Trợ lý PingPong AI"
                  aria-label="Trợ lý PingPong AI"
                  aria-pressed={aiChatOpen}
                  onClick={onToggleAiChat}
                >
                  <Sparkles size={19} aria-hidden="true" />
                </button>
              )}
              {selected && (
                <>
                  <button
                    type="button"
                    className="chat-info-button"
                    disabled={selectedMessageRequest?.status === 'pending'}
                    title={
                      selectedMessageRequest?.status === 'pending'
                        ? 'Kết bạn hoặc chấp nhận tin nhắn chờ để gọi thoại'
                        : 'Gọi thoại'
                    }
                    aria-label="Gọi thoại"
                    onClick={() =>
                      void callStart.current?.(selected.id, 'audio')
                    }
                  >
                    <UiIcon name="phone" />
                  </button>
                  <button
                    type="button"
                    className="chat-info-button"
                    disabled={selectedMessageRequest?.status === 'pending'}
                    title={
                      selectedMessageRequest?.status === 'pending'
                        ? 'Kết bạn hoặc chấp nhận tin nhắn chờ để gọi video'
                        : 'Gọi video'
                    }
                    aria-label="Gọi video"
                    onClick={() =>
                      void callStart.current?.(selected.id, 'video')
                    }
                  >
                    <UiIcon name="video" />
                  </button>
                  <button
                    ref={headerMenuButton}
                    type="button"
                    className={`chat-info-button header-more-button${aiChatOpen || workspacePanel || showInfo ? ' has-active' : ''}`}
                    title="Thêm tiện ích"
                    aria-label="Thêm tiện ích cuộc trò chuyện"
                    aria-expanded={headerMenuOpen}
                    aria-haspopup="dialog"
                    onClick={() => setHeaderMenuOpen((open) => !open)}
                  >
                    <MoreHorizontal size={19} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {selected && (
          <HeaderOverflowSheet
            open={headerMenuOpen}
            anchorRef={headerMenuButton}
            title={heading ?? 'Cuộc trò chuyện'}
            isGroup={selected.type === 'group'}
            aiChatOpen={aiChatOpen}
            canToggleAi={!!onToggleAiChat}
            workspacePanel={workspacePanel}
            showInfo={showInfo}
            onClose={() => setHeaderMenuOpen(false)}
            onToggleAi={() => onToggleAiChat?.()}
            onToggleSearch={() => toggleWorkspacePanel('search')}
            onTogglePins={() => toggleWorkspacePanel('group')}
            onToggleInfo={toggleConversationInfo}
          />
        )}
        {workspacePanel === 'search' && selected && (
          <MessageSearch
            conversationId={selected.id}
            onClose={() => setWorkspacePanel(undefined)}
            onJumpToMessage={(messageId) =>
              requestJumpToMessage(selected.id, messageId)
            }
          />
        )}
        {workspacePanel === 'group' && selected && (
          <GroupTools
            key={selected.id}
            isGroup={selected.type === 'group'}
            conversationId={selected.id}
            userId={user.id}
            onClose={() => setWorkspacePanel(undefined)}
            onJumpToMessage={(messageId) =>
              requestJumpToMessage(selected.id, messageId)
            }
          />
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <p className="list-status" role="status">
            Đang cập nhật…
          </p>
        )}
        {creating && !selected && (
          <ComposeForm
            type={type}
            onTypeChange={applyComposeMode}
            currentUserName={user.displayName}
            currentUserId={user.id}
            busy={busy}
            title={title}
            onTitle={setTitle}
            friends={friends}
            matchingFriends={matchingFriends}
            friendFilter={friendFilter}
            onFriendFilter={setFriendFilter}
            chosen={chosen}
            onToggleChosen={(peerId) =>
              setChosen((previous) =>
                previous.includes(peerId)
                  ? previous.filter((id) => id !== peerId)
                  : [...previous, peerId],
              )
            }
            onStartDirect={(peerId) => void startDirect(peerId)}
            onSubmit={() => void create()}
            onCancel={() => setCreating(false)}
          />
        )}
        {!selected && !creating && (
          <div className="chat-placeholder">
            <span className="chat-symbol">✉</span>
            <h2>Những cuộc trò chuyện của bạn</h2>
            <p>Chọn một đoạn chat hoặc nhắn mới cho một người bạn.</p>
            <button
              className="secondary accept"
              disabled={busy}
              onClick={() => compose('direct')}
            >
              Nhắn mới
            </button>
          </div>
        )}
        {selected && !showInfo && (
          <Chat
            key={selected.id}
            conversationId={selected.id}
            isGroup={selected.type === 'group'}
            onMessagesChange={setSharedMessages}
            user={user}
            peers={members.map((member) => ({
              ...member.user,
              displayName:
                selected.nicknames?.[member.id] ?? member.user.displayName,
            }))}
            background={selected.background}
            active={active}
            initialLastReadSequence={selected.membership.lastReadSequence}
            initialUnreadCount={selected.unreadCount ?? 0}
            jumpTarget={jumpTarget}
            messageRequest={selectedMessageRequest}
            requestActionBusy={busy}
            onAcceptMessageRequest={() => void acceptSelectedMessageRequest()}
            onRejectMessageRequest={() => void rejectSelectedMessageRequest()}
            onReadSequence={(sequence) =>
              setItems((previous) =>
                previous.map((item) =>
                  item.id === selected.id &&
                  BigInt(sequence) >
                    BigInt(item.membership.lastReadSequence ?? '0')
                    ? {
                        ...item,
                        membership: {
                          ...item.membership,
                          lastReadSequence: sequence,
                        },
                        unreadCount:
                          item.lastMessage &&
                          BigInt(sequence) >= BigInt(item.lastMessage.sequence)
                            ? 0
                            : item.unreadCount,
                      }
                    : item,
                ),
              )
            }
            onLatestMessage={(message) => {
              const mine = message.senderId === user.id;
              const autoAccepted =
                mine &&
                (selected.messageRequest?.direction === 'incoming' ||
                  items.find((i) => i.id === message.conversationId)
                    ?.messageRequest?.direction === 'incoming');
              if (autoAccepted) {
                setSelected((prev) =>
                  prev && prev.id === message.conversationId
                    ? { ...prev, messageRequest: null }
                    : prev,
                );
                setCategory('all');
                void loadFriends().catch(() => {});
              }
              setItems((previous) => {
                const preview = {
                  ...message,
                  body: message.body?.slice(0, 200) ?? null,
                  senderName: members.find(
                    (member) => member.user.id === message.senderId,
                  )?.user.displayName,
                };
                if (
                  !previous.some((item) => item.id === message.conversationId)
                ) {
                  if (selected?.id !== message.conversationId) return previous;
                  void list(undefined, true).catch(() => {});
                  void loadFriends().catch(() => {});
                  return [
                    {
                      ...selected,
                      peer: selectedPeer ?? selected.peer,
                      messageRequest: autoAccepted
                        ? null
                        : selected.messageRequest,
                      updatedAt: message.createdAt,
                      lastMessage: preview,
                      unreadCount: 0,
                    },
                    ...previous,
                  ];
                }
                return previous.map((item) =>
                  item.id === message.conversationId &&
                  (!item.lastMessage ||
                    BigInt(message.sequence) >=
                      BigInt(item.lastMessage.sequence))
                    ? {
                        ...item,
                        messageRequest: autoAccepted
                          ? null
                          : item.messageRequest,
                        updatedAt:
                          Date.parse(message.createdAt) >
                          Date.parse(item.updatedAt ?? item.createdAt)
                            ? message.createdAt
                            : item.updatedAt,
                        lastMessage: preview,
                      }
                    : item,
                );
              });
            }}
            onExpired={onExpired}
          />
        )}
        {selected && showInfo && (
          <section
            className="conversation-details"
            aria-label="Thông tin cuộc trò chuyện"
          >
            <button
              type="button"
              className="secondary details-back"
              onClick={() => setShowInfo(false)}
            >
              ← Quay lại trò chuyện
            </button>
            <h2>Thông tin cuộc trò chuyện</h2>
            <ConversationCustomization
              key={selected.id}
              conversation={selected}
              members={members}
              busy={busy}
              onSave={(path, body) =>
                run(async () => {
                  let result: { conversation: Conversation };
                  try {
                    result = await api.authenticated<{
                      conversation: Conversation;
                    }>(`/conversations/${selected.id}/${path}`, body, 'PATCH');
                  } catch (e) {
                    if (e instanceof api.ApiError && e.code === 'HTTP_404') {
                      throw new api.ApiError(404, 'CUSTOMIZATION_UNAVAILABLE');
                    }
                    throw e;
                  }
                  applyCustomization(result.conversation);
                }, 'Đã cập nhật tùy chỉnh đoạn chat.')
              }
            />
            <p className="intro">
              {isGroup
                ? `${members.length}/50 thành viên · ${roles[selected.membership.role]}`
                : 'Trò chuyện riêng'}{' '}
            </p>
            {manager && (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!rename.trim() || rename.trim().length > 200) {
                    setError('Tên nhóm cần từ 1 đến 200 ký tự.');
                    return;
                  }
                  void run(async () => {
                    await api.authenticated(
                      `/conversations/${selected.id}`,
                      { title: rename.trim() },
                      'PATCH',
                    );
                    await detail(selected.id);
                    await list();
                  }, 'Đã đổi tên nhóm.');
                }}
              >
                <label>
                  Tên nhóm
                  <input
                    value={rename}
                    maxLength={200}
                    disabled={busy}
                    onChange={(e) => setRename(e.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy || rename.trim() === selected.title}
                >
                  Lưu tên nhóm
                </button>
              </form>
            )}
            <h3>
              Thành viên <span className="member-count">{members.length}</span>
            </h3>
            {confirmation && (
              <div className="confirm-panel" role="alert">
                <p>{confirmation.text}</p>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      async () => {
                        let clearedResult:
                          | {
                              conversation: Conversation;
                              clearedAfterSequence: string;
                            }
                          | undefined;
                        try {
                          const res = await api.authenticated(
                            confirmation.path,
                            confirmation.body,
                            confirmation.method,
                          );
                          if (confirmation.clearHistory)
                            clearedResult = res as {
                              conversation: Conversation;
                              clearedAfterSequence: string;
                            };
                        } catch (e) {
                          if (
                            confirmation.leave &&
                            e instanceof api.ApiError &&
                            e.status === 404
                          ) {
                            /* Already left. */
                          } else {
                            if (!confirmation.leave)
                              await detail(selected.id).catch(() => {});
                            throw e;
                          }
                        }
                        const wasClearHistory = !!confirmation.clearHistory;
                        const wasLeave = !!confirmation.leave;
                        setConfirmation(undefined);
                        if (wasLeave) {
                          setSelected(undefined);
                          setMembers([]);
                        } else if (wasClearHistory && clearedResult) {
                          applyClearedHistoryState(
                            selected.id,
                            clearedResult.clearedAfterSequence,
                          );
                          setWorkspacePanel(undefined);
                          setShowInfo(false);
                        } else {
                          await detail(selected.id);
                        }
                        await list();
                      },
                      confirmation.clearHistory
                        ? 'Đã xóa lịch sử trò chuyện phía bạn.'
                        : 'Đã cập nhật hội thoại.',
                    )
                  }
                >
                  Xác nhận
                </button>{' '}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  Hủy
                </button>
              </div>
            )}
            <ul className="people-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span className="peer-avatar">
                    <Avatar peer={member.user} />
                  </span>
                  <div>
                    <strong>
                      {selected.nicknames?.[member.user.id] ??
                        member.user.displayName}
                      {member.user.id === user.id ? ' (bạn)' : ''}
                    </strong>
                    <p className="hint">
                      {isGroup ? roles[member.role] : 'Thành viên'}
                      {member.user.id !== user.id &&
                        presence[member.user.id] !== undefined &&
                        ` · ${presenceLabel(presence[member.user.id])}`}
                    </p>
                  </div>
                  <div className="peer-actions">
                    {owner && member.user.id !== user.id && (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `${member.role === 'admin' ? 'Gỡ quyền quản trị của' : 'Cấp quyền quản trị cho'} ${member.user.displayName}?`,
                              path: `/conversations/${selected.id}/members/${member.user.id}`,
                              method: 'PATCH',
                              body: {
                                role:
                                  member.role === 'admin' ? 'member' : 'admin',
                              },
                            })
                          }
                        >
                          {member.role === 'admin'
                            ? 'Gỡ quản trị'
                            : 'Cấp quản trị'}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `Chuyển quyền chủ nhóm cho ${member.user.displayName}? Bạn sẽ trở thành quản trị viên.`,
                              path: `/conversations/${selected.id}/transfer-ownership`,
                              method: 'POST',
                              body: { userId: member.user.id },
                            })
                          }
                        >
                          Chuyển chủ nhóm
                        </button>
                      </>
                    )}
                    {manager &&
                      member.user.id !== user.id &&
                      (owner
                        ? member.role !== 'owner'
                        : member.role === 'member') && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `Xóa ${member.user.displayName} khỏi nhóm?`,
                              path: `/conversations/${selected.id}/members/${member.user.id}`,
                              method: 'DELETE',
                            })
                          }
                        >
                          Xóa khỏi nhóm
                        </button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
            {manager && (
              <div className="invite-panel">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(loadFriends)}
                >
                  Chọn bạn để mời
                </button>
                {friends.length > 0 &&
                  (() => {
                    const invitable = friends.filter(
                      (peer) =>
                        !members.some((member) => member.user.id === peer.id),
                    );
                    if (invitable.length === 0) {
                      return (
                        <p className="hint">
                          Tất cả bạn bè của bạn đã có trong nhóm.
                        </p>
                      );
                    }
                    return (
                      <form
                        noValidate
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!invite) {
                            setError('Chọn người bạn muốn mời.');
                            return;
                          }
                          void run(async () => {
                            await api.authenticated(
                              `/conversations/${selected.id}/members`,
                              { userId: invite },
                            );
                            setInvite('');
                            await Promise.all([
                              detail(selected.id),
                              list(undefined, true),
                            ]);
                          }, 'Đã thêm thành viên.');
                        }}
                      >
                        <label>
                          Mời thành viên
                          <select
                            value={invite}
                            disabled={busy}
                            onChange={(e) => setInvite(e.target.value)}
                          >
                            <option value="">Chọn một người bạn</option>
                            {invitable.map((peer) => (
                              <option key={peer.id} value={peer.id}>
                                {peer.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="secondary"
                          disabled={busy || !invite || members.length >= 50}
                        >
                          Thêm vào nhóm
                        </button>
                      </form>
                    );
                  })()}
              </div>
            )}
            <div className="conversation-danger-zone">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    text: 'Xóa lịch sử trò chuyện phía bạn? Toàn bộ tin nhắn trước thời điểm này sẽ bị ẩn khỏi tài khoản của bạn. Người khác vẫn giữ nguyên lịch sử của họ.',
                    path: `/conversations/${selected.id}/history`,
                    method: 'DELETE',
                    clearHistory: true,
                  })
                }
              >
                Xóa lịch sử trò chuyện
              </button>
              {isGroup &&
                (owner ? (
                  <p className="hint">
                    Chuyển quyền chủ nhóm cho một thành viên trước khi rời nhóm.
                  </p>
                ) : (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        text: 'Rời nhóm này? Bạn sẽ không còn truy cập được hội thoại.',
                        path: `/conversations/${selected.id}/members/${user.id}`,
                        method: 'DELETE',
                        leave: true,
                      })
                    }
                  >
                    Rời nhóm
                  </button>
                ))}
            </div>
          </section>
        )}
      </div>
      {selected && !creating && !showInfo && (
        <ConversationSummaryPanel
          key={`${selected.id}:${selected.membership.clearedAfterSequence}`}
          conversationId={selected.id}
          heading={heading}
          peer={selectedPeer ?? undefined}
          memberCount={members.length}
          presence={presence}
          muted={!!muted[selected.id]}
          clearingHistory={busy}
          searchActive={workspacePanel === 'search'}
          pinsActive={workspacePanel === 'group'}
          sharedMessages={sharedMessages}
          onToggleSearch={() => toggleWorkspacePanel('search')}
          onTogglePins={() => toggleWorkspacePanel('group')}
          onToggleMute={() => toggleMute(selected.id)}
          onOpenInfo={() => {
            setShowInfo(true);
            void run(() => detail(selected.id));
          }}
          onClearHistory={() => clearConversationHistory(selected.id)}
          onViewAll={(type) => setMediaView({ id: selected.id, type })}
        />
      )}
      {mediaView && (
        <SharedMediaDialog
          key={`${mediaView.id}:${mediaView.type}`}
          conversationId={mediaView.id}
          type={mediaView.type}
          onClose={() => setMediaView(undefined)}
        />
      )}
      {incomingNotice && (
        <div className="incoming-message-toast" role="status">
          <button
            type="button"
            onClick={() => {
              void run(() => detail(incomingNotice.conversationId));
              setIncomingNotice(undefined);
            }}
          >
            <strong>Tin nhắn mới</strong>
            <span>{messageSummary(incomingNotice)}</span>
          </button>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => setIncomingNotice(undefined)}
          >
            ×
          </button>
        </div>
      )}
      <CallExperience
        user={user}
        onExpired={onExpired}
        registerStart={registerCallStart}
        conversationMeta={Object.fromEntries([
          ...items.map((item) => [
            item.id,
            {
              title: conversationTitle(item, directNames),
              peer: item.peer ?? null,
            },
          ]),
          ...(selected
            ? [
                [
                  selected.id,
                  {
                    title: heading ?? conversationTitle(selected, directNames),
                    peer: selectedPeer ?? selected.peer ?? null,
                  },
                ] as const,
              ]
            : []),
        ])}
      />
    </section>
  );
}
