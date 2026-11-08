import { Avatar } from '../../components/Avatar';
import type { Message, Receipt } from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import { sourceVersion, type AiKind } from '../ai/ai-model';
import { MessageMedia } from './ChatMedia';
import { MessageActions } from './MessageActions';
import { MessageReactions } from './MessageReactions';
import { SentStatus } from './SentStatus';
import { TranslationNote } from './TranslationNote';

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
  onUpdate,
  onReply,
  onReact,
  onCloseReactions,
  onAi,
  onHideTranslation,
  onOpenReceipts,
}: MessageBubbleProps) {
  const isCall = message.type === 'call';
  return (
    <div
      data-message-id={message.id}
      className={`chat-message ${mine ? 'mine' : ''}${isCall ? ' call-event' : ''}${message.content?.callStatus === 'missed' ? ' missed-call' : ''}${continuesGroup ? ' continues-group' : ''}`}
    >
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
      <div className={`message-body${isCall ? ' call-message-body' : ''}`}>
        {message.deletedAt ? (
          'Tin nhắn đã thu hồi'
        ) : message.type && message.type !== 'text' ? (
          <MessageMedia message={message} />
        ) : (
          message.body
        )}
      </div>
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
