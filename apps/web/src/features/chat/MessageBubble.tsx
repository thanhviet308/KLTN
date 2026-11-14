import { Avatar } from '../../components/Avatar';
import {
  parseGameInviteBody,
  type Message,
  type Receipt,
} from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import { sourceVersion, type AiKind } from '../ai/ai-model';
import { GAME_INFO, type CaroSession, type GameType } from '../games/CaroGame';
import { MessageMedia } from './ChatMedia';
import { MessageActions } from './MessageActions';
import { MessageReactions } from './MessageReactions';
import { SentStatus } from './SentStatus';
import { TranslationNote } from './TranslationNote';
import { SpamWarning } from './SpamWarning';
import { ReportButton } from '../reports/ReportDialog';

export interface Translation {
  version: string;
  text: string;
  language: string;
}

interface MessageBubbleProps {
  message: Message;
  mine: boolean;
  /** The next message is from the same sender within a few minutes. */
  continuesGroup: boolean;
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
  onOpenReceipts: () => void;
}

export function MessageBubble({
  message,
  mine,
  continuesGroup,
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
  onOpenReceipts,
}: MessageBubbleProps) {
  const isCall = message.type === 'call';
  const gameInvite =
    !message.deletedAt && (!message.type || message.type === 'text')
      ? parseGameInviteBody(message.body)
      : null;
  const gameMeta = gameInvite
    ? GAME_INFO[gameInvite.gameType as GameType]
    : undefined;
  const isThisGame =
    !!gameInvite &&
    !!currentGame &&
    (!gameInvite.gameId || currentGame.id === gameInvite.gameId);

  return (
    <div
      data-message-id={message.id}
      className={`chat-message ${mine ? 'mine' : ''}${isCall ? ' call-event' : ''}${message.content?.callStatus === 'missed' ? ' missed-call' : ''}${continuesGroup ? ' continues-group' : ''}`}
    >
      {isCall && message.content?.callId && (
        <ReportButton
          target={{
            targetType: 'call',
            targetId: message.content.callId,
            label: 'Báo cáo cuộc gọi',
          }}
        />
      )}
      {!isCall && (
        <>
          <MessageActions
            message={message}
            mine={mine}
            onUpdate={onUpdate}
            onReply={onReply}
            onReact={onReact}
            onAi={onAi}
          />
          <MessageReactions
            message={message}
            revision={reactionRevision}
            open={reactionOpen}
            onClose={onCloseReactions}
            active={active}
            realtimeConnected={realtimeConnected}
          />
        </>
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
      <div
        className={`message-body${isCall ? ' call-message-body' : ''}${
          gameInvite ? ' game-invite-message-body' : ''
        }`}
      >
        {message.deletedAt ? (
          'Tin nhắn đã thu hồi'
        ) : message.type && message.type !== 'text' ? (
          <MessageMedia message={message} />
        ) : gameInvite ? (
          <div className="game-chat-invite-card">
            <div className="game-chat-invite-header">
              <span className="game-chat-invite-kicker">
                {gameMeta?.groupOnly
                  ? '🎉 TRÒ CHƠI NHÓM'
                  : '🎮 THÁCH ĐẤU TRÒ CHƠI'}
              </span>
              {gameMeta && (
                <span className="game-chat-invite-badge">{gameMeta.badge}</span>
              )}
            </div>
            <strong className="game-chat-invite-title">
              {gameMeta?.name ?? 'Trò chơi trực tuyến'}
            </strong>
            <p className="game-chat-invite-desc">
              {gameMeta?.description ?? gameInvite.text}
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
                  ⚡ Chấp nhận & Vào chơi ngay
                </button>
              ) : (
                <button
                  type="button"
                  className="game-chat-invite-btn"
                  onClick={() => onOpenGame?.()}
                >
                  {isThisGame && currentGame.status === 'invited'
                    ? '⏳ Mở phòng chờ'
                    : isThisGame && currentGame.status === 'active'
                      ? '🔥 Vào bàn chơi ngay'
                      : '🎮 Mở bàn chơi'}
                </button>
              )}
            </div>
          </div>
        ) : (
          message.body
        )}
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
      {!isCall && showStatus && !message.deletedAt && (
        <SentStatus
          readers={readers}
          delivered={delivered}
          names={names}
          onOpen={onOpenReceipts}
        />
      )}
    </div>
  );
}
