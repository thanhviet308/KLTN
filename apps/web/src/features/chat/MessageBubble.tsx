import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type TouchEvent,
} from 'react';
import { Avatar } from '../../components/Avatar';
import {
  Ban,
  Clock3,
  CornerUpLeft,
  FileText,
  Gamepad2,
  Image as ImageIcon,
  MapPin,
  Mic,
  Phone,
  Play,
  Reply,
  Users,
  Zap,
} from 'lucide-react';
import {
  extractMessageReply,
  parseGameInviteBody,
  type Message,
  type Receipt,
  type ReplyTargetType,
} from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import {
  sourceVersion,
  type AiKind,
  type VoiceTranscribeOptions,
  type VoiceTranscriptState,
} from '../ai/ai-model';
import {
  GAME_INFO,
  type CaroSession,
  type GameType,
} from '../games/game-rules';
import { MessageMedia } from './ChatMedia';
import { MessageActions } from './MessageActions';
import { MessageReactions, useMessageReactions } from './MessageReactions';
import { SentStatus } from './SentStatus';
import { TranslationNote } from './TranslationNote';
import { VoiceTranscriptNote } from './VoiceTranscriptNote';
import { CallSummaryNote, type CallSummaryState } from './CallSummaryNote';
import { SpamWarning } from './SpamWarning';
import { ReportButton } from '../reports/ReportDialog';
import {
  evaluateSwipeTouch,
  isCoarseTouchDevice,
  isTouchControlElement,
  LONG_PRESS_DELAY_MS,
  shouldCancelLongPress,
  type SwipeAxis,
} from './touch-message-gestures';

function replyTypeIcon(type: ReplyTargetType) {
  switch (type) {
    case 'voice':
      return <Mic size={13} aria-hidden="true" />;
    case 'image':
      return <ImageIcon size={13} aria-hidden="true" />;
    case 'file':
      return <FileText size={13} aria-hidden="true" />;
    case 'location':
      return <MapPin size={13} aria-hidden="true" />;
    case 'call':
      return <Phone size={13} aria-hidden="true" />;
    case 'deleted':
      return <Ban size={13} aria-hidden="true" />;
    default:
      return null;
  }
}

export interface Translation {
  version: string;
  text: string;
  language: string;
}

interface MessageBubbleProps {
  message: Message;
  mine: boolean;
  currentUserId: string;
  isGroup?: boolean;
  showSenderName?: boolean;
  pinned?: boolean;
  continuesGroup: boolean;
  replyTargetDeleted?: boolean;
  onJumpToMessage?: (messageId: string) => void;
  peers: Peer[];
  names: (id: string) => string;
  active: boolean;
  realtimeConnected: boolean;
  reactionRevision: number;
  reactionOpen: boolean;
  translation?: Translation;
  /** Show delivery/read status (only for the user's latest sent message). */
  showStatus: boolean;
  readers: Receipt[];
  delivered: number;
  currentGame?: CaroSession | null;
  onOpenGame?: () => void;
  onAcceptGame?: (gameId: string) => void;
  onUpdate: (message: Message) => void;
  onReply: (message: Message) => void;
  onReact: () => void;
  onCloseReactions: () => void;
  onAi: (kind: AiKind) => void;
  onHideTranslation: () => void;
  voiceTranscript?: VoiceTranscriptState;
  onTranscribeVoice?: (options?: VoiceTranscribeOptions) => void;
  onHideVoiceTranscript?: () => void;
  onUseVoiceReply?: (reply: string) => void;
  callSummary?: CallSummaryState;
  onSummarizeCall?: () => void;
  onHideCallSummary?: () => void;
  onOpenReceipts: () => void;
}

export function MessageBubble({
  message,
  mine,
  currentUserId,
  isGroup,
  showSenderName,
  pinned,
  continuesGroup,
  replyTargetDeleted,
  onJumpToMessage,
  peers,
  names,
  active,
  realtimeConnected,
  reactionRevision,
  reactionOpen,
  translation,
  showStatus,
  readers,
  delivered,
  currentGame,
  onOpenGame,
  onAcceptGame,
  onUpdate,
  onReply,
  onReact,
  onCloseReactions,
  onAi,
  onHideTranslation,
  voiceTranscript,
  onTranscribeVoice,
  onHideVoiceTranscript,
  onUseVoiceReply,
  callSummary,
  onSummarizeCall,
  onHideCallSummary,
  onOpenReceipts,
}: MessageBubbleProps) {
  const isCall = message.type === 'call';
  const { reply, body: displayBody } = extractMessageReply(message);
  const gameInvite =
    !message.deletedAt && (!message.type || message.type === 'text')
      ? parseGameInviteBody(displayBody)
      : null;
  const gameMeta = gameInvite
    ? GAME_INFO[gameInvite.gameType as GameType]
    : undefined;
  const isThisGame =
    !!gameInvite &&
    !!currentGame &&
    (!gameInvite.gameId || currentGame.id === gameInvite.gameId);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const [swipeReady, setSwipeReady] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const suppressClickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const touchState = useRef<{
    startX: number;
    startY: number;
    axis: SwipeAxis;
    ready: boolean;
    hapticFired: boolean;
    longPressTimer?: ReturnType<typeof setTimeout>;
    scrollCleanup?: () => void;
  } | null>(null);

  const reactions = useMessageReactions({
    message,
    revision: reactionRevision,
    open: reactionOpen || sheetOpen,
    onClose: () => {
      onCloseReactions();
      setSheetOpen(false);
    },
    active,
    enabled: !isCall,
    realtimeConnected,
  });

  function clearTouchSession() {
    if (!touchState.current) return;
    if (touchState.current.longPressTimer !== undefined) {
      clearTimeout(touchState.current.longPressTimer);
    }
    touchState.current.scrollCleanup?.();
    touchState.current = null;
  }

  function armSuppressClick() {
    suppressClick.current = true;
    clearTimeout(suppressClickTimer.current);
    suppressClickTimer.current = setTimeout(() => {
      suppressClick.current = false;
    }, 450);
  }

  useEffect(() => {
    if (message.deletedAt) setSheetOpen(false);
  }, [message.deletedAt]);

  useEffect(
    () => () => {
      clearTouchSession();
      clearTimeout(suppressClickTimer.current);
    },
    [],
  );

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (isCall || message.deletedAt || sheetOpen) return;
    if (event.touches.length !== 1) {
      clearTouchSession();
      setSwiping(false);
      setSwipeReady(false);
      setSwipeOffset(0);
      return;
    }
    if (isTouchControlElement(event.target)) return;
    const touch = event.touches[0];
    clearTouchSession();

    const timeline = bubbleRef.current?.closest('.message-timeline');
    const cancelHold = () => {
      if (touchState.current?.longPressTimer !== undefined) {
        clearTimeout(touchState.current.longPressTimer);
        touchState.current.longPressTimer = undefined;
      }
    };
    const onScroll = () => cancelHold();
    if (timeline)
      timeline.addEventListener('scroll', onScroll, { passive: true });

    const longPressTimer = setTimeout(() => {
      const current = touchState.current;
      if (!current || current.axis !== 'undecided') return;
      current.scrollCleanup?.();
      touchState.current = null;
      window.getSelection()?.removeAllRanges();
      armSuppressClick();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* Vibration API unsupported in some mobile WebViews. */
      }
      setSheetOpen(true);
    }, LONG_PRESS_DELAY_MS);

    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      axis: 'undecided',
      ready: false,
      hapticFired: false,
      longPressTimer,
      scrollCleanup: () => {
        if (timeline) timeline.removeEventListener('scroll', onScroll);
      },
    };
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    const current = touchState.current;
    if (!current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - current.startX;
    const dy = touch.clientY - current.startY;
    if (shouldCancelLongPress(dx, dy) && current.longPressTimer !== undefined) {
      clearTimeout(current.longPressTimer);
      current.longPressTimer = undefined;
      current.scrollCleanup?.();
    }
    const evaluated = evaluateSwipeTouch({
      startX: current.startX,
      startY: current.startY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      mine,
      axis: current.axis,
    });
    current.axis = evaluated.axis;
    current.ready = evaluated.ready;
    if (evaluated.axis === 'horizontal') {
      setSwiping(true);
      setSwipeOffset(evaluated.offsetX);
      setSwipeReady(evaluated.ready);
      if (evaluated.ready && !current.hapticFired) {
        current.hapticFired = true;
        try {
          navigator.vibrate?.(10);
        } catch {
          /* Ignore unsupported haptic feedback. */
        }
      }
    }
  }

  function finishTouch() {
    const session = touchState.current;
    clearTouchSession();
    if (!session) return;
    if (session.axis === 'horizontal') armSuppressClick();
    if (session.ready) onReply(message);
    setSwiping(false);
    setSwipeReady(false);
    setSwipeOffset(0);
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!isCall && !message.deletedAt && isCoarseTouchDevice()) {
      event.preventDefault();
    }
  }

  const targetDeleted = reply?.type === 'deleted' || !!replyTargetDeleted;
  const replyType: ReplyTargetType = targetDeleted
    ? 'deleted'
    : (reply?.type ?? 'text');
  const replyExcerpt = targetDeleted
    ? 'Tin nhắn đã thu hồi'
    : (reply?.excerpt ?? '');
  const senderLabel = names(message.senderId);
  const targetLabel = reply?.senderId
    ? reply.senderId === currentUserId
      ? undefined
      : names(reply.senderId)
    : reply?.legacySenderName;
  const replyContextLabel = reply
    ? mine
      ? reply.senderId === currentUserId
        ? 'Bạn đã trả lời chính mình'
        : `Bạn đã trả lời ${targetLabel ?? 'thành viên'}`
      : reply.senderId === currentUserId
        ? `${senderLabel} đã trả lời bạn`
        : reply.senderId === message.senderId
          ? `${senderLabel} đã trả lời chính mình`
          : `${senderLabel} đã trả lời ${targetLabel ?? 'thành viên'}`
    : '';
  const replyIcon = replyTypeIcon(replyType);

  return (
    <div
      ref={bubbleRef}
      data-message-id={message.id}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={finishTouch}
      onTouchCancel={finishTouch}
      onClickCapture={handleClickCapture}
      onContextMenu={handleContextMenu}
      style={
        swipeOffset !== 0
          ? ({ '--swipe-x': `${swipeOffset}px` } as CSSProperties)
          : undefined
      }
      className={`chat-message ${mine ? 'mine' : ''}${isCall ? ' call-event' : ''}${message.content?.callStatus === 'missed' ? ' missed-call' : ''}${continuesGroup ? ' continues-group' : ''}${!isCall && !message.deletedAt ? ' has-swipe-motion' : ''}${swiping ? ' is-swiping' : ''}${sheetOpen && !message.deletedAt ? ' is-sheet-target' : ''}`}
    >
      {(swiping || swipeOffset !== 0) && !isCall && !message.deletedAt && (
        <span
          className={`swipe-reply-indicator${swipeReady ? ' is-ready' : ''}`}
          style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 36) }}
          aria-hidden="true"
        >
          <Reply size={16} strokeWidth={2.2} />
        </span>
      )}
      {isCall && message.content?.callId && (
        <div className="message-tools call-report-tools">
          <ReportButton
            compact
            target={{
              targetType: 'call',
              targetId: message.content.callId,
              label: 'Báo cáo cuộc gọi',
            }}
          />
        </div>
      )}
      {!mine && (
        <span
          className={`message-sender-avatar${continuesGroup ? ' avatar-spacer' : ''}`}
          role={continuesGroup ? undefined : 'img'}
          aria-hidden={continuesGroup || undefined}
          aria-label={continuesGroup ? undefined : names(message.senderId)}
          title={continuesGroup ? undefined : names(message.senderId)}
        >
          <Avatar
            peer={
              peers.find((peer) => peer.id === message.senderId) ?? {
                displayName: names(message.senderId),
              }
            }
          />
        </span>
      )}
      <div className="message-bubble-slot">
        {showSenderName && (
          <span className="message-sender-name">{senderLabel}</span>
        )}
        {reply && (
          <div className="message-reply-stack">
            <span className="message-reply-context">
              <CornerUpLeft size={11} aria-hidden="true" />
              <span>{replyContextLabel}</span>
            </span>
            {reply.messageId && onJumpToMessage ? (
              <button
                type="button"
                className="message-reply-quote"
                title="Xem tin nhắn gốc"
                onClick={() => onJumpToMessage(reply.messageId!)}
              >
                {replyIcon && (
                  <span className="message-reply-icon">{replyIcon}</span>
                )}
                <span className="message-reply-excerpt">{replyExcerpt}</span>
              </button>
            ) : (
              <div className="message-reply-quote is-static">
                {replyIcon && (
                  <span className="message-reply-icon">{replyIcon}</span>
                )}
                <span className="message-reply-excerpt">{replyExcerpt}</span>
              </div>
            )}
          </div>
        )}
        <div className="message-body-anchor">
          {!isCall && (
            <MessageActions
              pinned={pinned}
              message={message}
              mine={mine}
              isGroup={isGroup}
              senderName={names(message.senderId)}
              gameTitle={gameMeta?.name}
              mobileSheetOpen={sheetOpen && !message.deletedAt}
              onCloseMobileSheet={() => setSheetOpen(false)}
              reactions={reactions}
              onUpdate={onUpdate}
              onReply={onReply}
              onReact={onReact}
              onAi={onAi}
              onTranscribeVoice={
                onTranscribeVoice ? () => onTranscribeVoice() : undefined
              }
            />
          )}
          <div
            tabIndex={0}
            className={`message-body${isCall ? ' call-message-body' : ''}${
              gameInvite ? ' game-invite-message-body' : ''
            }`}
          >
            {!message.deletedAt && pinned && (
              <small className="message-pin-tag">
                📌 Đã ghim
                <br />
              </small>
            )}
            {!message.deletedAt && message.content?.forwarded && (
              <small className="workspace-mention-label">
                Đã chuyển tiếp
                <br />
              </small>
            )}
            {!message.deletedAt && !!message.content?.mentions?.length && (
              <div className="workspace-mention-label">
                Nhắc đến:{' '}
                {message.content.mentions
                  .map((id) => `@${names(id)}`)
                  .join(', ')}
              </div>
            )}
            {message.deletedAt ? (
              'Tin nhắn đã thu hồi'
            ) : message.type && message.type !== 'text' ? (
              <MessageMedia
                message={message}
                transcribing={voiceTranscript?.loading}
                transcribed={!!voiceTranscript?.transcript}
                onTranscribe={
                  message.type === 'voice' && onTranscribeVoice
                    ? () => onTranscribeVoice()
                    : undefined
                }
                callSummarizing={callSummary?.loading}
                callSummarized={callSummary?.summary !== undefined}
                onSummarizeCall={
                  message.type === 'call' && onSummarizeCall
                    ? () => onSummarizeCall()
                    : undefined
                }
              />
            ) : gameInvite ? (
              <div className={`game-chat-invite-card${mine ? ' is-mine' : ''}`}>
                <div className="game-chat-invite-header">
                  <span className="game-chat-invite-kicker">
                    {gameMeta?.groupOnly ? (
                      <Users size={14} aria-hidden="true" />
                    ) : (
                      <Gamepad2 size={14} aria-hidden="true" />
                    )}
                    {gameMeta?.groupOnly ? 'Nhóm' : 'Mời chơi'}
                  </span>
                  {gameMeta && (
                    <span className="game-chat-invite-badge">
                      {gameMeta.badge}
                    </span>
                  )}
                </div>
                <strong className="game-chat-invite-title">
                  {gameMeta?.name ?? 'Trò chơi trực tuyến'}
                </strong>
                <p className="game-chat-invite-desc">
                  {gameMeta?.subtitle ?? gameInvite.text}
                </p>
                <div className="game-chat-invite-footer">
                  {isThisGame && currentGame.status === 'invited' && !mine ? (
                    <button
                      type="button"
                      className="game-chat-invite-btn is-accept"
                      onClick={() => {
                        if (onAcceptGame && currentGame.id) {
                          onAcceptGame(currentGame.id);
                        } else {
                          onOpenGame?.();
                        }
                      }}
                    >
                      <Zap size={16} aria-hidden="true" /> Chấp nhận & chơi
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="game-chat-invite-btn"
                      onClick={() => onOpenGame?.()}
                    >
                      {isThisGame && currentGame.status === 'invited' ? (
                        <Clock3 size={16} aria-hidden="true" />
                      ) : (
                        <Play size={16} aria-hidden="true" />
                      )}
                      {isThisGame && currentGame.status === 'invited'
                        ? 'Phòng chờ'
                        : isThisGame && currentGame.status === 'active'
                          ? 'Vào bàn chơi'
                          : 'Mở bàn chơi'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              displayBody
            )}
          </div>
          {!isCall && (
            <MessageReactions
              message={message}
              open={reactionOpen}
              onClose={onCloseReactions}
              controller={reactions}
            />
          )}
          {!isCall &&
            showStatus &&
            !message.deletedAt &&
            readers.length <= 1 && (
              <SentStatus
                readers={readers}
                delivered={delivered}
                peers={peers}
                names={names}
                onOpen={onOpenReceipts}
              />
            )}
        </div>
      </div>
      {!mine &&
        !message.deletedAt &&
        message.type !== 'call' &&
        message.spam?.suspicious && <SpamWarning score={message.spam.score} />}
      {!message.deletedAt &&
        translation?.version === sourceVersion(message) && (
          <TranslationNote
            language={translation.language}
            text={translation.text}
            onHide={onHideTranslation}
          />
        )}
      {!message.deletedAt &&
        message.type === 'voice' &&
        voiceTranscript &&
        onTranscribeVoice &&
        onHideVoiceTranscript &&
        onUseVoiceReply && (
          <VoiceTranscriptNote
            state={voiceTranscript}
            onRetry={() => onTranscribeVoice()}
            onTranslate={(language) =>
              onTranscribeVoice({ translateTo: language })
            }
            onSuggestReplies={() => onTranscribeVoice({ includeReplies: true })}
            onUseReply={onUseVoiceReply}
            onHide={onHideVoiceTranscript}
          />
        )}
      {!message.deletedAt &&
        message.type === 'call' &&
        callSummary &&
        onSummarizeCall &&
        onHideCallSummary && (
          <CallSummaryNote
            state={callSummary}
            onRetry={onSummarizeCall}
            onHide={onHideCallSummary}
          />
        )}
      {!isCall && showStatus && !message.deletedAt && readers.length > 1 && (
        <SentStatus
          readers={readers}
          delivered={delivered}
          peers={peers}
          names={names}
          onOpen={onOpenReceipts}
        />
      )}
    </div>
  );
}
