import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  ArrowLeft,
  Clock,
  Crown,
  Flag,
  Gamepad2,
  RotateCcw,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import * as api from '../../lib/api';
import { UiIcon } from '../../components/UiIcon';
import {
  CHESS_PIECES,
  GAME_INFO,
  GROUP_QUIZ_BANK,
  MEMORY_ICONS,
  RPS_HANDS,
  TRUTH_DARE_PROMPTS,
  XIANGQI_PIECES,
  findDropTargetCell,
  findWinningCells,
  getOthelloFlips,
  getValidTargetsForPiece,
  isOwnCell,
  type GameCategory,
  type GameType,
} from './game-rules';

export { GAME_INFO, type GameType };

type Status = 'invited' | 'active' | 'won' | 'draw' | 'declined' | 'forfeited';

export interface CaroSession {
  id: string;
  conversationId: string;
  gameType: GameType;
  xUserId: string;
  oUserId: string;
  status: Status;
  turn: 'X' | 'O';
  board: number[];
  winnerId: string | null;
  moveCount: number;
  updatedAt?: string;
  turnLimitSeconds?: number;
  turnStartedAt?: string;
  forfeitReason?: 'timeout' | 'surrender';
}

function getDefaultTurnLimitSeconds(gameType: GameType): number {
  if (
    gameType === 'chess' ||
    gameType === 'xiangqi' ||
    gameType === 'caro' ||
    gameType === 'othello' ||
    gameType === 'checkers' ||
    gameType === 'co_ganh' ||
    gameType === 'sudoku_duel'
  ) {
    return 45;
  }
  if (
    gameType === 'connect_four' ||
    gameType === 'memory_match' ||
    gameType === 'treasure_hunt' ||
    gameType === 'group_spy_hunt' ||
    gameType === 'group_heist_vault'
  ) {
    return 30;
  }
  return 25;
}

export function CaroGame({
  conversationId,
  userId,
  names,
  socket,
  onClose,
  isGroup = false,
  onGameChange,
}: {
  conversationId: string;
  userId: string;
  names: (id: string) => string;
  socket?: Socket;
  onClose: () => void;
  isGroup?: boolean;
  onGameChange?: (game: CaroSession | null) => void;
}) {
  const [game, setGame] = useState<CaroSession | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [browsingCatalog, setBrowsingCatalog] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [hoverColumn, setHoverColumn] = useState<number | null>(null);
  const [hoverCell, setHoverCell] = useState<number | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [lastMoveCells, setLastMoveCells] = useState<Set<number>>(new Set());
  const prevBoardRef = useRef<{ gameId: string; board: number[] } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(45);
  const turnDeadlineRef = useRef<number>(0);
  const timeoutClaimedKeyRef = useRef<string>('');

  const updateGameState = useCallback(
    (next: CaroSession | null) => {
      setGame(next);
      setSelectedFrom(null);
      onGameChange?.(next);
      if (next && (next.status === 'invited' || next.status === 'active')) {
        setBrowsingCatalog(false);
      }
      if (!next || next.status !== 'active') {
        setConfirmForfeit(false);
      }
      if (next) {
        const prev = prevBoardRef.current;
        if (prev && prev.gameId === next.id) {
          const maxLen = Math.max(prev.board.length, next.board.length);
          const changed = new Set<number>();
          for (let i = 0; i < maxLen; i++) {
            if ((prev.board[i] ?? 0) !== (next.board[i] ?? 0)) {
              changed.add(i);
            }
          }
          if (changed.size > 0) setLastMoveCells(changed);
        } else if (next.moveCount === 0) {
          setLastMoveCells(new Set());
        }
        prevBoardRef.current = {
          gameId: next.id,
          board: [...(next.board ?? [])],
        };
      } else {
        prevBoardRef.current = null;
        setLastMoveCells(new Set());
      }
    },
    [onGameChange],
  );

  const load = useCallback(async () => {
    try {
      const current = (
        await api.authenticated<{ game: CaroSession | null }>(
          `/conversations/${conversationId}/games/current`,
        )
      ).game;
      updateGameState(current);
    } catch (e) {
      setError(api.errorMessage(e));
    }
  }, [conversationId, updateGameState]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const update = (result: { game: CaroSession }) => {
      if (result.game.conversationId === conversationId) {
        updateGameState(result.game);
      }
    };
    socket.on('game:updated', update);
    return () => {
      socket.off('game:updated', update);
    };
  }, [socket, conversationId, updateGameState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedFrom !== null) {
          setSelectedFrom(null);
        } else if (confirmForfeit) {
          setConfirmForfeit(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedFrom, confirmForfeit, onClose]);

  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const next = (
        await api.authenticated<{ game: CaroSession }>(path, body, 'POST')
      ).game;
      updateGameState(next);
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const myMark = game?.xUserId === userId ? 'X' : 'O';
  const info = game ? GAME_INFO[game.gameType] : undefined;
  const opponentId = game
    ? game.xUserId === userId
      ? game.oUserId
      : game.xUserId
    : '';
  const myTurn = game?.status === 'active' && game.turn === myMark;
  const isFinished =
    !!game && ['won', 'draw', 'declined', 'forfeited'].includes(game.status);
  const showCatalog = !game || browsingCatalog;
  const turnLimitSeconds = game
    ? (game.turnLimitSeconds ?? getDefaultTurnLimitSeconds(game.gameType))
    : 45;

  // Reset and run per-turn countdown timer whenever active game turn/move changes
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const limitSec =
      game.turnLimitSeconds ?? getDefaultTurnLimitSeconds(game.gameType);
    const serverStartMs = Date.parse(
      game.turnStartedAt ?? game.updatedAt ?? '',
    );
    const now = Date.now();
    let deadline = now + limitSec * 1000;
    if (
      Number.isFinite(serverStartMs) &&
      Math.abs(now - serverStartMs) <= limitSec * 1000 + 8000
    ) {
      deadline = serverStartMs + limitSec * 1000;
    }
    turnDeadlineRef.current = deadline;
    const initialRem = Math.max(
      0,
      Math.min(limitSec, Math.ceil((deadline - now) / 1000)),
    );
    setRemainingSeconds(initialRem);

    const turnKey = `${game.id}:${game.turn}:${game.moveCount}:${game.turnStartedAt ?? ''}`;
    const interval = setInterval(() => {
      const rem = Math.max(
        0,
        Math.min(
          limitSec,
          Math.ceil((turnDeadlineRef.current - Date.now()) / 1000),
        ),
      );
      setRemainingSeconds(rem);
      if (rem <= 0 && timeoutClaimedKeyRef.current !== turnKey) {
        timeoutClaimedKeyRef.current = turnKey;
        void api
          .authenticated<{ game: CaroSession }>(
            `/games/${game.id}/timeout`,
            undefined,
            'POST',
          )
          .then((res) => {
            if (res.game) updateGameState(res.game);
          })
          .catch(() => {});
      }
    }, 250);
    return () => clearInterval(interval);
  }, [
    game?.id,
    game?.status,
    game?.gameType,
    game?.turn,
    game?.moveCount,
    game?.turnLimitSeconds,
    game?.turnStartedAt,
    game?.updatedAt,
    updateGameState,
  ]);

  const winningCells = useMemo(() => {
    if (!game || game.status !== 'won') return new Set<number>();
    return findWinningCells(game.board ?? [], game.gameType);
  }, [game]);

  const validStepTargets = useMemo(() => {
    if (!game || !info?.stepMove || !myTurn || selectedFrom === null) {
      return new Set<number>();
    }
    return getValidTargetsForPiece(
      game.board ?? [],
      game.gameType,
      selectedFrom,
      myMark,
    );
  }, [game, info, myTurn, selectedFrom, myMark]);

  const othelloValidMap = useMemo(() => {
    const map = new Map<number, number[]>();
    if (!game || game.gameType !== 'othello' || !myTurn) return map;
    const playerNum = myMark === 'X' ? 1 : 2;
    for (let i = 0; i < 64; i++) {
      const flips = getOthelloFlips(game.board ?? [], i, playerNum);
      if (flips.length > 0) map.set(i, flips);
    }
    return map;
  }, [game, myTurn, myMark]);

  const othelloHoverFlips = useMemo(() => {
    if (hoverCell === null) return new Set<number>();
    return new Set(othelloValidMap.get(hoverCell) ?? []);
  }, [hoverCell, othelloValidMap]);

  const dropTargetCell = useMemo(() => {
    if (
      !game ||
      game.gameType !== 'connect_four' ||
      game.status !== 'active' ||
      !myTurn ||
      hoverColumn === null ||
      !info
    ) {
      return -1;
    }
    return findDropTargetCell(
      game.board ?? [],
      hoverColumn,
      info.rows,
      info.columns,
    );
  }, [game, myTurn, hoverColumn, info]);

  const scoreMetrics = useMemo(() => {
    if (!game) return null;
    const b = game.board ?? [];
    if (game.gameType === 'memory_match') {
      return { x: `${b[16] ?? 0} cặp`, o: `${b[17] ?? 0} cặp` };
    }
    if (game.gameType === 'treasure_hunt') {
      return { x: `${b[36] ?? 0} điểm`, o: `${b[37] ?? 0} điểm` };
    }
    if (game.gameType === 'rps_showdown') {
      return { x: `${b[0] ?? 0} thắng`, o: `${b[1] ?? 0} thắng` };
    }
    if (game.gameType === 'pirate_roulette') {
      return { x: `${b[20] ?? 0} vàng`, o: `${b[21] ?? 0} vàng` };
    }
    if (game.gameType === 'sudoku_duel') {
      return { x: `${b[16] ?? 0} điểm`, o: `${b[17] ?? 0} điểm` };
    }
    if (game.gameType === 'group_bomb_pass') {
      return { x: `${b[16] ?? 0} điểm`, o: `${b[17] ?? 0} điểm` };
    }
    if (game.gameType === 'group_truth_dare') {
      return { x: `${b[12] ?? 0} điểm`, o: `${b[13] ?? 0} điểm` };
    }
    if (game.gameType === 'group_lucky_wheel') {
      return { x: `${b[16] ?? 0} điểm`, o: `${b[17] ?? 0} điểm` };
    }
    if (game.gameType === 'group_spy_hunt') {
      return { x: `${b[25] ?? 0} điểm`, o: `${b[26] ?? 0} điểm` };
    }
    if (game.gameType === 'group_heist_vault') {
      return { x: `${b[12] ?? 0} điểm`, o: `${b[13] ?? 0} điểm` };
    }
    if (game.gameType === 'group_quiz_arena') {
      return { x: `${b[0] ?? 0} điểm`, o: `${b[1] ?? 0} điểm` };
    }
    if (game.gameType === 'othello' || game.gameType === 'co_ganh') {
      return {
        x: `${b.filter((v) => v === 1).length} quân`,
        o: `${b.filter((v) => v === 2).length} quân`,
      };
    }
    if (
      game.gameType === 'checkers' ||
      game.gameType === 'chess' ||
      game.gameType === 'xiangqi'
    ) {
      return {
        x: `${b.filter((v) => v > 0).length} quân`,
        o: `${b.filter((v) => v < 0).length} quân`,
      };
    }
    return null;
  }, [game]);

  const mySideLabel = useMemo(() => {
    if (!game) return '';
    if (game.gameType === 'xiangqi')
      return myMark === 'X' ? 'Quân Đỏ' : 'Quân Đen';
    if (game.gameType === 'chess')
      return myMark === 'X' ? 'Quân Trắng' : 'Quân Đen';
    if (game.gameType === 'othello')
      return myMark === 'X' ? 'Quân Đen' : 'Quân Trắng';
    if (game.gameType === 'checkers' || game.gameType === 'co_ganh')
      return myMark === 'X' ? 'Quân Đỏ' : 'Quân Xanh';
    if (game.gameType === 'connect_four')
      return myMark === 'X' ? 'Đĩa Vàng' : 'Đĩa Đỏ';
    return `Lượt của bạn`;
  }, [game, myMark]);

  const statusHeadline = useMemo(() => {
    if (!game) return '';
    if (game.status === 'invited') {
      if (info?.groupOnly) {
        return game.xUserId === userId
          ? 'Đang chờ các thành viên trong nhóm tham gia bàn chơi…'
          : `${names(game.xUserId)} vừa mở bàn ${info?.name} cho cả nhóm!`;
      }
      return game.xUserId === userId
        ? `Đang chờ ${names(game.oUserId)} chấp nhận lời mời…`
        : `${names(game.xUserId)} mời bạn chơi ${info?.name}`;
    }
    if (game.status === 'active') {
      if (game.gameType === 'group_bomb_pass') {
        return myTurn
          ? 'Đến lượt bạn · Chọn cắt 1 sợi dây trên quả bom hẹn giờ!'
          : `Đang chờ ${names(opponentId)} cắt dây bom…`;
      }
      if (game.gameType === 'group_truth_dare') {
        return myTurn
          ? 'Đến lượt bạn · Bốc 1 phong bì Sự Thật hoặc Thử Thách!'
          : `Đang chờ ${names(opponentId)} bốc phong bì…`;
      }
      if (game.gameType === 'group_lucky_wheel') {
        return myTurn
          ? 'Đến lượt bạn · Mở 1 Rương Nhân Phẩm để thử vận may!'
          : `Đang chờ ${names(opponentId)} mở Rương Nhân Phẩm…`;
      }
      if (game.gameType === 'group_spy_hunt') {
        return myTurn
          ? 'Đến lượt bạn · Khám xét 1 phòng trong căn cứ để truy bắt Gián điệp!'
          : `Đang chờ ${names(opponentId)} khám xét căn cứ…`;
      }
      if (game.gameType === 'group_heist_vault') {
        return myTurn
          ? 'Đến lượt bạn · Chọn 1 ổ khóa và thử mật mã 1–4 để phá két sắt!'
          : `Đang chờ ${names(opponentId)} dò mã két sắt…`;
      }
      if (game.gameType === 'group_quiz_arena') {
        return myTurn
          ? 'Đến lượt bạn · Chọn đáp án đúng A, B, C hoặc D!'
          : `Đang chờ ${names(opponentId)} trả lời câu hỏi…`;
      }
      if (game.gameType === 'memory_match') {
        const firstPick = game.board[18] ?? -1;
        if (myTurn) {
          return firstPick >= 0
            ? 'Bạn đã mở thẻ thứ 1 · Hãy lật thẻ thứ 2 để ghép cặp!'
            : 'Đến lượt bạn · Hãy chọn lật 2 thẻ bài giống nhau!';
        }
        return `Đang chờ ${names(opponentId)} lật thẻ…`;
      }
      if (game.gameType === 'treasure_hunt') {
        return myTurn
          ? 'Đến lượt bạn · Chọn 1 ô đất để đào kho báu (chú ý số radar)!'
          : `Đang chờ ${names(opponentId)} đào kho báu…`;
      }
      if (game.gameType === 'rps_showdown') {
        return myTurn
          ? 'Đến lượt bạn · Hãy bí mật chọn Búa ✊, Bao ✋ hoặc Kéo ✌️!'
          : `${names(opponentId)} đang chọn chiêu…`;
      }
      if (game.gameType === 'pirate_roulette') {
        return myTurn
          ? 'Đến lượt bạn · Chọn 1 khe trống để cắm kiếm vào thùng rượu!'
          : `Đang chờ ${names(opponentId)} cắm kiếm…`;
      }
      if (game.gameType === 'sudoku_duel') {
        return myTurn
          ? selectedFrom !== null
            ? 'Hãy chọn số 1, 2, 3 hoặc 4 ở thanh bên dưới để điền vào ô!'
            : 'Đến lượt bạn · Chạm vào một ô trống (?) trên bảng để giải mã!'
          : `Đang chờ ${names(opponentId)} giải mã ô số…`;
      }
      if (myTurn) {
        return info?.stepMove
          ? selectedFrom !== null
            ? 'Chọn ô đích được đánh dấu sáng để di chuyển quân'
            : `Đến lượt bạn (${mySideLabel}) · Chạm vào quân cờ để đi`
          : `Đến lượt bạn đi (${mySideLabel})`;
      }
      return `Đang chờ ${names(opponentId)} suy nghĩ nước đi…`;
    }
    if (game.status === 'draw') return 'Bất phân thắng bại — Ván đấu hòa!';
    if (game.status === 'declined')
      return 'Lời mời chơi đã được hủy hoặc từ chối';
    const isTimeoutForfeit =
      game.status === 'forfeited' &&
      (game.forfeitReason === 'timeout' || remainingSeconds === 0);
    if (game.winnerId === userId) {
      if (isTimeoutForfeit)
        return `Hết giờ! ${names(opponentId)} đã quá thời gian suy nghĩ — Bạn thắng!`;
      if (game.status === 'forfeited')
        return `Bạn thắng do ${names(opponentId)} đã đầu hàng!`;
      if (game.gameType === 'pirate_roulette')
        return `Chiến thắng! ${names(opponentId)} đã đâm trúng bẫy Hải Tặc!`;
      return 'Tuyệt vời! Bạn đã giành chiến thắng!';
    }
    if (isTimeoutForfeit)
      return `Hết thời gian suy nghĩ · ${names(game.winnerId ?? opponentId)} giành chiến thắng`;
    if (game.status === 'forfeited')
      return `Bạn đã đầu hàng · ${names(game.winnerId ?? opponentId)} thắng`;
    if (game.gameType === 'pirate_roulette')
      return `BÙM! Bạn đã đâm trúng khe bẫy làm Hải Tặc bật tung!`;
    return `${names(game.winnerId ?? opponentId)} đã chiến thắng ván này`;
  }, [
    game,
    userId,
    names,
    info,
    myTurn,
    opponentId,
    selectedFrom,
    mySideLabel,
    remainingSeconds,
  ]);

  const xPlayerName = game
    ? game.xUserId === userId
      ? 'Bạn'
      : names(game.xUserId)
    : '';
  const oPlayerName = game
    ? game.oUserId === userId
      ? 'Bạn'
      : names(game.oUserId)
    : '';

  function handleCellClick(cell: number) {
    if (!game || !info || busy || !myTurn) return;
    if (game.gameType === 'sudoku_duel') {
      if ((game.board[cell] ?? 0) === 0) {
        setSelectedFrom((prev) => (prev === cell ? null : cell));
      }
      return;
    }
    if (info.stepMove) {
      const value = game.board[cell] ?? 0;
      const own = isOwnCell(game.gameType, value, myMark);
      if (own) {
        setSelectedFrom((prev) => (prev === cell ? null : cell));
        return;
      }
      if (selectedFrom !== null && validStepTargets.has(cell)) {
        const from = selectedFrom;
        setSelectedFrom(null);
        void action(`/games/${game.id}/moves`, { from, cell });
      }
      return;
    }
    void action(`/games/${game.id}/moves`, { cell });
  }

  return (
    <div
      className="game-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`caro-panel${
          game && !showCatalog
            ? ` panel-mode-${game.gameType}`
            : ' panel-catalog'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-title"
      >
        <header className="game-modal-header">
          <div className="game-header-title-wrap">
            {!showCatalog && isFinished && (
              <button
                type="button"
                className="game-back-pill"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setBrowsingCatalog(true);
                }}
              >
                <ArrowLeft size={14} aria-hidden="true" />
                Chọn trò chơi khác
              </button>
            )}
            <span className="game-kicker">
              <Gamepad2 size={13} aria-hidden="true" />
              PINGPONG ARCADE
            </span>
            <h2 id="game-title">
              {showCatalog ? 'Trung tâm trò chơi' : info?.name}
            </h2>
          </div>
          <button
            type="button"
            className="game-icon-button"
            onClick={onClose}
            aria-label="Đóng trò chơi"
            title="Đóng (Esc)"
          >
            <UiIcon name="close" />
          </button>
        </header>

        <div className="game-modal-body">
          {error && (
            <div className="game-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="game-error-dismiss"
                onClick={() => setError('')}
                aria-label="Đóng thông báo lỗi"
              >
                ✕
              </button>
            </div>
          )}

          {game === undefined ? (
            <div className="game-loading" role="status">
              <span className="game-loading-spinner" aria-hidden="true" />
              <p>Đang tải sảnh trò chơi…</p>
            </div>
          ) : showCatalog ? (
            <GameCatalog
              busy={busy}
              isGroup={isGroup}
              previousGame={isFinished ? game : null}
              onBackToPrevious={() => setBrowsingCatalog(false)}
              onInvite={(gameType) =>
                void action(`/conversations/${conversationId}/games`, {
                  gameType,
                })
              }
            />
          ) : (
            <div
              className={`game-arena${
                ['active', 'won', 'draw', 'forfeited'].includes(game.status)
                  ? ' is-split-layout'
                  : ''
              }`}
            >
              <div className="game-sidebar-hud">
                {/* Matchup Scoreboard */}
                <div
                  className="game-matchup-bar"
                  aria-label="Thông tin hai người chơi"
                >
                  <div
                    className={`game-player-card player-x${
                      game.status === 'active' && game.turn === 'X'
                        ? ' is-active-turn'
                        : ''
                    }${
                      game.winnerId && game.winnerId === game.xUserId
                        ? ' is-winner'
                        : ''
                    }`}
                  >
                    <span
                      className={`game-player-token token-x mode-${game.gameType}`}
                      aria-hidden="true"
                    >
                      {getPlayerBadgeIcon(game.gameType, 'X')}
                    </span>
                    <div className="game-player-meta">
                      <strong>
                        {xPlayerName}
                        {game.winnerId === game.xUserId && (
                          <Crown
                            size={14}
                            className="winner-crown"
                            aria-label="Người chiến thắng"
                          />
                        )}
                      </strong>
                      <small>
                        {scoreMetrics
                          ? `${scoreMetrics.x} · ${
                              game.status === 'active' && game.turn === 'X'
                                ? 'Đang đi'
                                : 'Chờ lượt'
                            }`
                          : game.status === 'active' && game.turn === 'X'
                            ? 'Đang tới lượt'
                            : game.xUserId === userId
                              ? 'Quân của bạn'
                              : 'Đối thủ'}
                      </small>
                    </div>
                  </div>

                  <div className="game-vs-divider">
                    <span className="game-vs-badge">
                      <Swords size={14} aria-hidden="true" />
                    </span>
                    <small>{game.moveCount} lượt</small>
                  </div>

                  <div
                    className={`game-player-card player-o${
                      game.status === 'active' && game.turn === 'O'
                        ? ' is-active-turn'
                        : ''
                    }${
                      game.winnerId && game.winnerId === game.oUserId
                        ? ' is-winner'
                        : ''
                    }`}
                  >
                    <div className="game-player-meta align-right">
                      <strong>
                        {game.winnerId === game.oUserId && (
                          <Crown
                            size={14}
                            className="winner-crown"
                            aria-label="Người chiến thắng"
                          />
                        )}
                        {oPlayerName}
                      </strong>
                      <small>
                        {scoreMetrics
                          ? `${scoreMetrics.o} · ${
                              game.status === 'active' && game.turn === 'O'
                                ? 'Đang đi'
                                : 'Chờ lượt'
                            }`
                          : game.status === 'active' && game.turn === 'O'
                            ? 'Đang tới lượt'
                            : game.oUserId === userId
                              ? 'Quân của bạn'
                              : 'Đối thủ'}
                      </small>
                    </div>
                    <span
                      className={`game-player-token token-o mode-${game.gameType}`}
                      aria-hidden="true"
                    >
                      {getPlayerBadgeIcon(game.gameType, 'O')}
                    </span>
                  </div>
                </div>

                {/* Live Turn Thinking Timer */}
                {game.status === 'active' && (
                  <div
                    className={`game-turn-clock${
                      remainingSeconds <= 8
                        ? ' is-danger'
                        : remainingSeconds <= 15
                          ? ' is-warning'
                          : ''
                    }${myTurn ? ' is-my-clock' : ''}`}
                    role="timer"
                    aria-label="Thời gian suy nghĩ mỗi lượt"
                  >
                    <div className="game-turn-clock-top">
                      <span className="game-turn-clock-label">
                        <Clock size={14} aria-hidden="true" />
                        {myTurn
                          ? 'Thời gian suy nghĩ của bạn'
                          : `Thời gian của ${names(opponentId)}`}
                      </span>
                      <strong className="game-turn-clock-value">
                        {remainingSeconds}s / {turnLimitSeconds}s
                      </strong>
                    </div>
                    <div className="game-turn-clock-track" aria-hidden="true">
                      <div
                        className="game-turn-clock-fill"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              (remainingSeconds / turnLimitSeconds) * 100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                    <small className="game-turn-clock-hint">
                      Hết giờ không đi nước mới sẽ tự động bị xử thua
                    </small>
                  </div>
                )}

                {/* Status Banner */}
                <div
                  className={`game-status status-${game.status}${
                    myTurn ? ' is-my-turn' : ''
                  }${game.winnerId === userId ? ' is-victory' : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="game-status-main">
                    {game.status === 'won' || game.status === 'forfeited' ? (
                      <Trophy size={18} aria-hidden="true" />
                    ) : game.status === 'active' && myTurn ? (
                      <Sparkles size={18} aria-hidden="true" />
                    ) : null}
                    <span>{statusHeadline}</span>
                  </div>
                  {info && (
                    <small className="game-rule-pill">{info.winRule}</small>
                  )}
                </div>

                {/* Active Prompt Card for Group Truth or Dare */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_truth_dare' && (
                    <div className="truth-dare-banner">
                      {(game.board[14] ?? 0) > 0 &&
                      TRUTH_DARE_PROMPTS[game.board[14]!] ? (
                        <>
                          <span
                            className={`td-badge td-${TRUTH_DARE_PROMPTS[game.board[14]!]!.kind}`}
                          >
                            {TRUTH_DARE_PROMPTS[game.board[14]!]!.badge} · Người
                            rút:{' '}
                            {(game.board[15] ?? 1) === 1
                              ? xPlayerName
                              : oPlayerName}
                          </span>
                          <p>{TRUTH_DARE_PROMPTS[game.board[14]!]!.text}</p>
                        </>
                      ) : (
                        <p>
                          💌 Chọn mở một phong bì bên phải để nhận câu hỏi{' '}
                          <strong>Sự Thật (+15đ)</strong> hoặc{' '}
                          <strong>Thử Thách (+25đ)</strong>!
                        </p>
                      )}
                    </div>
                  )}

                {/* Helper Legend for Group Lucky Wheel */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_lucky_wheel' && (
                    <div className="game-helper-bar">
                      <span>👑 Vương miện: +50đ</span>
                      <span>💎 Kim cương: +30đ</span>
                      <span>🧧 Lì xì: +15đ</span>
                      <span>🍀 Cỏ 4 lá: +10đ</span>
                      <span>🌀 Hố đen: -15đ</span>
                      <strong>Lượt {game.moveCount}/10</strong>
                    </div>
                  )}

                {/* Helper Legend for Group Spy Hunt */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_spy_hunt' && (
                    <div className="game-helper-bar">
                      <span>🕵️ Gián điệp: +5đ</span>
                      <span>📂 Hồ sơ mật: +2đ</span>
                      <span>📡 Radar: báo mục tiêu lân cận</span>
                      <span>🚨 Bẫy báo động: -2đ</span>
                      <strong>Còn {game.board[27] ?? 0} mục tiêu</strong>
                    </div>
                  )}

                {/* Helper Legend for Treasure Hunt */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'treasure_hunt' && (
                    <div className="game-helper-bar">
                      <span>💎 Kim cương: +4đ</span>
                      <span>💰 Túi vàng: +2đ</span>
                      <span>🧭 Số Radar: báo kho báu quanh ô</span>
                      <span>💣 Bom: -2đ</span>
                      <strong>Còn {game.board[38] ?? 0} kho báu</strong>
                    </div>
                  )}

                {/* Sudoku Number Picker Bar */}
                {game.status === 'active' &&
                  game.gameType === 'sudoku_duel' && (
                    <div className="sudoku-numpad">
                      <span>
                        {selectedFrom !== null
                          ? `Điền số cho ô hàng ${Math.floor(selectedFrom / 4) + 1}, cột ${(selectedFrom % 4) + 1}:`
                          : 'Chọn 1 ô trống (?) trên bảng rồi bấm số:'}
                      </span>
                      <div className="sudoku-numpad-buttons">
                        {[1, 2, 3, 4].map((num) => (
                          <button
                            key={num}
                            type="button"
                            className="sudoku-num-btn"
                            disabled={busy || !myTurn || selectedFrom === null}
                            onClick={() => {
                              if (selectedFrom === null) return;
                              const targetCell = selectedFrom;
                              setSelectedFrom(null);
                              void action(`/games/${game.id}/moves`, {
                                from: targetCell,
                                cell: num,
                              });
                            }}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Active Game Footer Controls */}
                {game.status === 'active' && (
                  <div className="game-active-footer">
                    {!confirmForfeit ? (
                      <button
                        type="button"
                        className="game-text-button"
                        disabled={busy}
                        onClick={() => setConfirmForfeit(true)}
                      >
                        <Flag size={15} aria-hidden="true" />
                        Xin đầu hàng
                      </button>
                    ) : (
                      <div className="game-forfeit-confirm" role="alert">
                        <span>Bạn chắc chắn muốn nhận thua ván này?</span>
                        <div className="game-forfeit-actions">
                          <button
                            type="button"
                            className="game-danger-button"
                            disabled={busy}
                            onClick={() =>
                              void action(`/games/${game.id}/forfeit`)
                            }
                          >
                            Xác nhận đầu hàng
                          </button>
                          <button
                            type="button"
                            className="game-secondary"
                            disabled={busy}
                            onClick={() => setConfirmForfeit(false)}
                          >
                            Tiếp tục chơi
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Post-match Actions */}
                {['won', 'draw', 'forfeited'].includes(game.status) && (
                  <div className="game-postmatch-actions">
                    <button
                      type="button"
                      className="game-secondary"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        setBrowsingCatalog(true);
                      }}
                    >
                      Đổi trò chơi
                    </button>
                    <button
                      type="button"
                      className="game-primary game-rematch"
                      disabled={busy}
                      onClick={() =>
                        void action(`/conversations/${conversationId}/games`, {
                          gameType: game.gameType,
                        })
                      }
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      Mời chơi ván mới
                    </button>
                  </div>
                )}
              </div>

              <div className="game-main-stage">
                {/* Invitation State */}
                {game.status === 'invited' && (
                  <div className="game-invite-stage">
                    <div className="game-invite-hero">
                      <GameMiniIllustration gameType={game.gameType} />
                      <div className="game-invite-stage-copy">
                        <h3>{info?.name}</h3>
                        <p>{info?.description}</p>
                      </div>
                    </div>
                    {(
                      info?.groupOnly
                        ? game.xUserId !== userId
                        : game.oUserId === userId
                    ) ? (
                      <div className="game-actions">
                        <button
                          type="button"
                          className="game-secondary"
                          disabled={busy}
                          onClick={() =>
                            void action(`/games/${game.id}/decline`)
                          }
                        >
                          Từ chối
                        </button>
                        <button
                          type="button"
                          className="game-primary"
                          disabled={busy}
                          onClick={() =>
                            void action(`/games/${game.id}/accept`)
                          }
                        >
                          {info?.groupOnly
                            ? 'Tham gia bàn nhóm'
                            : 'Chấp nhận & vào chơi'}
                        </button>
                      </div>
                    ) : (
                      <div className="game-actions">
                        <button
                          type="button"
                          className="game-secondary"
                          disabled={busy}
                          onClick={() =>
                            void action(`/games/${game.id}/decline`)
                          }
                        >
                          Hủy lời mời / Đổi trò chơi
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Declined State */}
                {game.status === 'declined' && (
                  <div className="game-declined-stage">
                    <p>
                      Ván <strong>{info?.name}</strong> chưa bắt đầu. Bạn có thể
                      mời lại hoặc chọn một trò chơi khác để thử sức cùng bạn
                      bè!
                    </p>
                    <div className="game-postmatch-actions">
                      <button
                        type="button"
                        className="game-secondary"
                        disabled={busy}
                        onClick={() => setBrowsingCatalog(true)}
                      >
                        Chọn trò chơi khác
                      </button>
                      <button
                        type="button"
                        className="game-primary"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            `/conversations/${conversationId}/games`,
                            {
                              gameType: game.gameType,
                            },
                          )
                        }
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                        Mời lại {info?.name}
                      </button>
                    </div>
                  </div>
                )}

                {/* SPECIAL STAGE 1: Oẳn Tù Tì Đại Chiến (rps_showdown) */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'rps_showdown' && (
                    <RpsShowdownStage
                      game={game}
                      myTurn={myTurn}
                      busy={busy}
                      xPlayerName={xPlayerName}
                      oPlayerName={oPlayerName}
                      onPickHand={(handIdx) =>
                        void action(`/games/${game.id}/moves`, {
                          cell: handIdx,
                        })
                      }
                    />
                  )}

                {/* SPECIAL STAGE 2: Hải Tặc Đâm Thùng (pirate_roulette) */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'pirate_roulette' && (
                    <PirateRouletteStage
                      game={game}
                      myTurn={myTurn}
                      busy={busy}
                      onStabSlot={(slot) =>
                        void action(`/games/${game.id}/moves`, { cell: slot })
                      }
                    />
                  )}

                {/* SPECIAL STAGE 3: Chuyền Bom Hẹn Giờ Nhóm (group_bomb_pass) */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_bomb_pass' && (
                    <GroupBombPassStage
                      game={game}
                      myTurn={myTurn}
                      busy={busy}
                      onCutWire={(wire) =>
                        void action(`/games/${game.id}/moves`, { cell: wire })
                      }
                    />
                  )}

                {/* SPECIAL STAGE 4: Phi Vụ Phá Két Sắt Nhóm (group_heist_vault) */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_heist_vault' && (
                    <GroupHeistVaultStage
                      game={game}
                      myTurn={myTurn}
                      busy={busy}
                      onCrackDigit={(lockIdx, digit) =>
                        void action(`/games/${game.id}/moves`, {
                          from: lockIdx,
                          cell: digit,
                        })
                      }
                    />
                  )}

                {/* SPECIAL STAGE 5: Đấu Trường Đố Vui Nhóm (group_quiz_arena) */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  game.gameType === 'group_quiz_arena' && (
                    <GroupQuizArenaStage
                      game={game}
                      myTurn={myTurn}
                      busy={busy}
                      onAnswer={(optIdx) =>
                        void action(`/games/${game.id}/moves`, { cell: optIdx })
                      }
                    />
                  )}

                {/* Standard & Puzzle Grid Boards */}
                {['active', 'won', 'draw', 'forfeited'].includes(game.status) &&
                  info &&
                  game.gameType !== 'rps_showdown' &&
                  game.gameType !== 'pirate_roulette' &&
                  game.gameType !== 'group_bomb_pass' &&
                  game.gameType !== 'group_heist_vault' &&
                  game.gameType !== 'group_quiz_arena' && (
                    <div
                      className={`game-board-frame frame-${game.gameType}`}
                      onMouseLeave={() => {
                        setHoverColumn(null);
                        setHoverCell(null);
                      }}
                    >
                      <div
                        className={`caro-board board-${game.gameType}${
                          myTurn ? ' is-interactive' : ''
                        }`}
                        role="grid"
                        aria-label={`Bàn chơi ${info.name}`}
                        style={{
                          gridTemplateColumns: `repeat(${info.columns}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${info.rows}, minmax(0, 1fr))`,
                        }}
                      >
                        {game.gameType === 'xiangqi' && <XiangqiBoardOverlay />}
                        {game.gameType === 'co_ganh' && <CoGanhBoardOverlay />}

                        {Array.from(
                          { length: info.rows * info.columns },
                          (_, cell) => {
                            const value = game.board[cell] ?? 0;
                            const row = Math.floor(cell / info.columns);
                            const col = cell % info.columns;
                            const isDarkSquare = (row + col) % 2 === 1;
                            const isWinning = winningCells.has(cell);
                            const isLastMove = lastMoveCells.has(cell);
                            const isSelected = selectedFrom === cell;
                            const isValidTarget = validStepTargets.has(cell);
                            const ownPiece = isOwnCell(
                              game.gameType,
                              value,
                              myMark,
                            );
                            const isOthelloValid = othelloValidMap.has(cell);
                            const isOthelloFlip = othelloHoverFlips.has(cell);

                            const isColHover =
                              game.gameType === 'connect_four' &&
                              myTurn &&
                              hoverColumn === col;
                            const isDropTarget =
                              game.gameType === 'connect_four' &&
                              dropTargetCell === cell;

                            const canClick =
                              !busy &&
                              myTurn &&
                              (info.stepMove
                                ? ownPiece || isValidTarget
                                : game.gameType === 'connect_four'
                                  ? !game.board[col]
                                  : game.gameType === 'othello'
                                    ? isOthelloValid
                                    : game.gameType === 'memory_match' ||
                                        game.gameType === 'treasure_hunt' ||
                                        game.gameType === 'sudoku_duel'
                                      ? value === 0 ||
                                        (game.gameType === 'memory_match' &&
                                          (game.board[18] ?? -1) === -1 &&
                                          ((game.board[19] ?? -1) === cell ||
                                            (game.board[20] ?? -1) === cell))
                                      : !value);

                            return (
                              <button
                                key={cell}
                                type="button"
                                role="gridcell"
                                className={[
                                  value
                                    ? value > 0
                                      ? `mark-${value} side-x`
                                      : `mark-neg-${Math.abs(value)} side-o`
                                    : 'is-empty',
                                  (game.gameType === 'chess' ||
                                    game.gameType === 'checkers') &&
                                  isDarkSquare
                                    ? 'sq-dark'
                                    : 'sq-light',
                                  game.gameType === 'sudoku_duel' &&
                                  ((row < 2 && col < 2) ||
                                    (row >= 2 && col >= 2))
                                    ? 'sudoku-box-alt'
                                    : '',
                                  isWinning ? 'is-winning-cell' : '',
                                  isLastMove ? 'is-last-move' : '',
                                  isSelected ? 'is-selected-piece' : '',
                                  isValidTarget
                                    ? value
                                      ? 'is-capture-target'
                                      : 'is-move-target'
                                    : '',
                                  isOthelloValid ? 'is-othello-valid' : '',
                                  isOthelloFlip ? 'is-othello-flip' : '',
                                  isColHover ? 'is-col-hover' : '',
                                  isDropTarget
                                    ? `is-drop-target preview-${myMark.toLowerCase()}`
                                    : '',
                                  !value &&
                                  myTurn &&
                                  (game.gameType === 'caro' ||
                                    game.gameType === 'tic_tac_toe')
                                    ? `hover-preview-${myMark.toLowerCase()}`
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                aria-label={`Hàng ${row + 1}, cột ${col + 1}`}
                                disabled={!canClick}
                                onMouseEnter={() => {
                                  setHoverCell(cell);
                                  if (game.gameType === 'connect_four') {
                                    setHoverColumn(col);
                                  }
                                }}
                                onClick={() => handleCellClick(cell)}
                              >
                                {renderCellContent(game.gameType, value)}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function getPlayerBadgeIcon(gameType: GameType, mark: 'X' | 'O') {
  if (gameType === 'group_bomb_pass') return mark === 'X' ? '💣' : '✂️';
  if (gameType === 'group_truth_dare') return mark === 'X' ? '💬' : '🔥';
  if (gameType === 'group_lucky_wheel') return mark === 'X' ? '👑' : '🍀';
  if (gameType === 'group_spy_hunt') return mark === 'X' ? '🕵️' : '📡';
  if (gameType === 'group_heist_vault') return mark === 'X' ? '🔓' : '🔑';
  if (gameType === 'group_quiz_arena') return mark === 'X' ? '🧠' : '⚡';
  if (gameType === 'memory_match') return mark === 'X' ? '🦊' : '🐼';
  if (gameType === 'treasure_hunt') return mark === 'X' ? '💎' : '💰';
  if (gameType === 'rps_showdown') return mark === 'X' ? '✊' : '✌️';
  if (gameType === 'pirate_roulette') return mark === 'X' ? '🗡️' : '🏴‍☠️';
  if (gameType === 'sudoku_duel') return mark === 'X' ? '1' : '4';
  if (gameType === 'xiangqi') return mark === 'X' ? '帥' : '將';
  if (gameType === 'chess') return mark === 'X' ? '♔' : '♚';
  if (
    gameType === 'connect_four' ||
    gameType === 'othello' ||
    gameType === 'co_ganh' ||
    gameType === 'checkers'
  )
    return '●';
  return mark;
}

function RpsShowdownStage({
  game,
  myTurn,
  busy,
  xPlayerName,
  oPlayerName,
  onPickHand,
}: {
  game: CaroSession;
  myTurn: boolean;
  busy: boolean;
  xPlayerName: string;
  oPlayerName: string;
  onPickHand: (handIdx: number) => void;
}) {
  const b = game.board ?? [];
  const currentRound = Math.min(5, (b[12] ?? 0) + 1);
  const xLocked = (b[14] ?? 0) === 1;

  return (
    <div className="rps-arena">
      <div className="rps-status-cards">
        <div className={`rps-fighter-box ${xLocked ? 'is-locked' : ''}`}>
          <strong>{xPlayerName}</strong>
          <span>
            {xLocked
              ? '🔒 Đã khóa chiêu bí mật!'
              : game.status === 'active' && game.turn === 'X'
                ? '⏳ Đang chọn chiêu…'
                : 'Sẵn sàng'}
          </span>
        </div>
        <div className="rps-round-badge">
          {game.status === 'active' ? `HIỆP ${currentRound} / 5` : 'KẾT QUẢ'}
        </div>
        <div className="rps-fighter-box">
          <strong>{oPlayerName}</strong>
          <span>
            {game.status === 'active' && game.turn === 'O'
              ? '⚡ Đang ra chiêu quyết định…'
              : 'Chờ mở chiêu'}
          </span>
        </div>
      </div>

      {game.status === 'active' && (
        <div className="rps-hand-choices">
          {[0, 1, 2].map((idx) => {
            const hand = RPS_HANDS[idx + 1]!;
            return (
              <button
                key={idx}
                type="button"
                className="rps-hand-btn"
                disabled={busy || !myTurn}
                onClick={() => onPickHand(idx)}
              >
                <span className="rps-hand-emoji" aria-hidden="true">
                  {hand.emoji}
                </span>
                <strong>{hand.name}</strong>
                <small>{hand.desc}</small>
              </button>
            );
          })}
        </div>
      )}

      <div className="rps-history">
        <h4>Lịch sử các hiệp đấu</h4>
        <div className="rps-history-grid">
          {Array.from({ length: 5 }, (_, i) => {
            const xHand = b[2 + i * 2] ?? 0;
            const oHand = b[2 + i * 2 + 1] ?? 0;
            const played = xHand > 0 && oHand > 0;
            return (
              <div
                key={i}
                className={`rps-history-item ${played ? 'is-played' : ''}`}
              >
                <small>Hiệp {i + 1}</small>
                {played ? (
                  <div className="rps-history-hands">
                    <span>{RPS_HANDS[xHand]?.emoji}</span>
                    <em>vs</em>
                    <span>{RPS_HANDS[oHand]?.emoji}</span>
                  </div>
                ) : (
                  <span className="rps-history-pending">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PirateRouletteStage({
  game,
  myTurn,
  busy,
  onStabSlot,
}: {
  game: CaroSession;
  myTurn: boolean;
  busy: boolean;
  onStabSlot: (slot: number) => void;
}) {
  const b = game.board ?? [];
  const popped = b.slice(0, 20).includes(-9);

  return (
    <div className="pirate-arena">
      <div className={`pirate-barrel-hero ${popped ? 'is-popped' : ''}`}>
        <div className="pirate-avatar-wrap" aria-hidden="true">
          <span className="pirate-character">{popped ? '🏴‍☠️💥' : '🏴‍☠️'}</span>
          <span className="pirate-barrel-body">🛢️</span>
        </div>
        <div className="pirate-barrel-copy">
          <strong>
            {popped
              ? 'BÙM! Hải Tặc đã bật tung khỏi thùng rượu!'
              : 'Thùng Rượu Hải Tặc (20 khe cắm kiếm)'}
          </strong>
          <small>
            {popped
              ? 'Khe bẫy đã bị kích hoạt!'
              : `Đã cắm ${game.moveCount}/20 thanh kiếm · Chỉ có 1 khe bẫy duy nhất!`}
          </small>
        </div>
      </div>

      <div
        className="pirate-slots-grid"
        role="grid"
        aria-label="Các khe cắm kiếm trên thùng rượu"
      >
        {Array.from({ length: 20 }, (_, slot) => {
          const val = b[slot] ?? 0;
          const isTrap = val === -9;
          const isBonus = val === 3 || val === 4;
          const isUsed = val !== 0;

          return (
            <button
              key={slot}
              type="button"
              className={[
                'pirate-slot-btn',
                isTrap ? 'is-trap' : '',
                isBonus ? 'is-bonus' : '',
                isUsed ? 'is-used' : 'is-available',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={busy || !myTurn || isUsed}
              onClick={() => onStabSlot(slot)}
            >
              <span className="pirate-slot-icon" aria-hidden="true">
                {isTrap ? '💥' : isBonus ? '🌟' : isUsed ? '🗡️' : '🕳️'}
              </span>
              <small>
                {isTrap
                  ? 'BẪY!'
                  : isBonus
                    ? '+25 Vàng'
                    : isUsed
                      ? 'An toàn'
                      : `Khe #${slot + 1}`}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GroupBombPassStage({
  game,
  myTurn,
  busy,
  onCutWire,
}: {
  game: CaroSession;
  myTurn: boolean;
  busy: boolean;
  onCutWire: (wire: number) => void;
}) {
  const b = game.board ?? [];
  const exploded = b.slice(0, 16).includes(-9);

  return (
    <div className="pirate-arena">
      <div className={`pirate-barrel-hero ${exploded ? 'is-exploded' : ''}`}>
        <div className="pirate-mascot" aria-hidden="true">
          {exploded ? '💥🔥' : '💣⏱️'}
        </div>
        <div className="pirate-barrel-copy">
          <strong>
            {exploded
              ? 'BÙM! Dây ngòi nổ đã bị cắt — Quả bom phát nổ!'
              : 'Bom Hẹn Giờ Nhóm (16 Dây dẫn bí mật)'}
          </strong>
          <p>
            {exploded
              ? 'Ván chơi kết thúc do chạm trúng dây kích nổ!'
              : `Đã cắt ${game.moveCount}/16 sợi dây · Có 4 dây Thưởng (+25đ) và 1 dây Nổ Bom!`}
          </p>
        </div>
      </div>

      <div
        className="pirate-slots-grid bomb-wires-grid"
        role="grid"
        aria-label="Bảng cắt dây bom nhóm"
      >
        {Array.from({ length: 16 }, (_, wire) => {
          const val = b[wire] ?? 0;
          const isTrap = val === -9;
          const isBonus = val === 3 || val === 4;
          const isUsed = val !== 0;

          return (
            <button
              key={wire}
              type="button"
              className={[
                'pirate-slot-btn',
                isTrap ? 'is-trap' : '',
                isBonus ? 'is-bonus' : '',
                isUsed ? 'is-used' : 'is-available',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={busy || !myTurn || isUsed}
              onClick={() => onCutWire(wire)}
            >
              <span className="pirate-slot-icon" aria-hidden="true">
                {isTrap ? '💥' : isBonus ? '⚡' : isUsed ? '✂️' : '🔌'}
              </span>
              <small>
                {isTrap
                  ? 'NỔ BOM!'
                  : isBonus
                    ? '+25đ'
                    : isUsed
                      ? '+10đ'
                      : `Dây #${wire + 1}`}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GroupHeistVaultStage({
  game,
  myTurn,
  busy,
  onCrackDigit,
}: {
  game: CaroSession;
  myTurn: boolean;
  busy: boolean;
  onCrackDigit: (lockIdx: number, digit: number) => void;
}) {
  const [selectedLock, setSelectedLock] = useState<number>(0);
  const b = game.board ?? [];

  return (
    <div className="rps-arena">
      <div className="vault-locks-grid">
        {Array.from({ length: 4 }, (_, idx) => {
          const lockVal = b[idx] ?? 0;
          const hint = b[4 + idx] ?? 0;
          const lastGuess = b[8 + idx] ?? 0;
          const cracked = lockVal > 0;
          const digit =
            lockVal > 20 ? lockVal - 20 : lockVal > 10 ? lockVal - 10 : 0;
          const isSelected = !cracked && selectedLock === idx;

          return (
            <button
              key={idx}
              type="button"
              className={`vault-lock-card ${cracked ? 'is-cracked' : ''} ${
                isSelected ? 'is-selected' : ''
              }`}
              disabled={cracked}
              onClick={() => setSelectedLock(idx)}
            >
              <span className="vault-lock-icon" aria-hidden="true">
                {cracked ? '🔓' : '🔒'}
              </span>
              <strong>Khóa #{idx + 1}</strong>
              <span className="vault-lock-code">
                {cracked
                  ? `Mã: ${digit}`
                  : lastGuess > 0
                    ? `Vừa thử: ${lastGuess}`
                    : 'Chưa mở'}
              </span>
              <small className="vault-lock-hint">
                {cracked
                  ? 'Đã phá khóa (+30đ)'
                  : hint === 1
                    ? '▲ Lớn hơn số vừa thử'
                    : hint === -1
                      ? '▼ Nhỏ hơn số vừa thử'
                      : 'Chọn để thử mã 1–4'}
              </small>
            </button>
          );
        })}
      </div>

      {game.status === 'active' && (
        <div className="sudoku-numpad">
          <span>
            {(b[selectedLock] ?? 0) > 0
              ? 'Ổ khóa này đã mở! Hãy chọn một ổ khóa 🔒 khác ở trên:'
              : `Nhập mật mã thử cho Khóa #${selectedLock + 1} (Đúng +30đ, Sai nhận gợi ý +5đ):`}
          </span>
          <div className="sudoku-numpad-buttons">
            {[1, 2, 3, 4].map((digit) => (
              <button
                key={digit}
                type="button"
                className="sudoku-num-btn"
                disabled={busy || !myTurn || (b[selectedLock] ?? 0) > 0}
                onClick={() => onCrackDigit(selectedLock, digit)}
              >
                {digit}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupQuizArenaStage({
  game,
  myTurn,
  busy,
  onAnswer,
}: {
  game: CaroSession;
  myTurn: boolean;
  busy: boolean;
  onAnswer: (optIdx: number) => void;
}) {
  const b = game.board ?? [];
  const step = Math.min(4, b[2] ?? 0);
  const qIdx = b[3 + step] ?? 0;
  const currentQuiz = GROUP_QUIZ_BANK[qIdx] ?? GROUP_QUIZ_BANK[0]!;
  const lastQIdx = b[8] ?? -1;
  const lastResult = b[10] ?? 0;
  const lastCorrect = b[11] ?? 0;
  const prevQuiz = lastQIdx >= 0 ? GROUP_QUIZ_BANK[lastQIdx] : null;

  return (
    <div className="rps-arena quiz-arena">
      {prevQuiz && (
        <div
          className={`quiz-feedback-bar ${
            lastResult === 1 ? 'is-correct' : 'is-wrong'
          }`}
        >
          {lastResult === 1
            ? `✅ Chính xác (+20đ)! Đáp án câu trước: ${prevQuiz.options[lastCorrect]}`
            : `❌ Chưa đúng! Đáp án đúng câu trước là: ${prevQuiz.options[lastCorrect]}`}
        </div>
      )}

      <div className="quiz-question-box">
        <span className="quiz-step-pill">
          {game.status === 'active'
            ? `CÂU HỎI ${step + 1} / 5`
            : 'HOÀN THÀNH 5 CÂU HỎI'}
        </span>
        <h3>{currentQuiz.question}</h3>
      </div>

      <div className="quiz-options-grid">
        {currentQuiz.options.map((opt, idx) => (
          <button
            key={idx}
            type="button"
            className="quiz-option-btn"
            disabled={busy || !myTurn || game.status !== 'active'}
            onClick={() => onAnswer(idx)}
          >
            <span className="quiz-opt-letter">
              {String.fromCharCode(65 + idx)}
            </span>
            <strong>{opt}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function renderCellContent(gameType: GameType, value: number) {
  if (gameType === 'group_truth_dare') {
    if (!value) {
      return (
        <span className="memory-card-back" aria-hidden="true">
          💌
        </span>
      );
    }
    const isDare = value >= 200;
    return (
      <span
        className={`memory-card-face is-matched ${
          isDare ? 'owner-x' : 'owner-o'
        }`}
      >
        <span className="memory-emoji" aria-hidden="true">
          {isDare ? '🔥' : '💬'}
        </span>
        <small>{isDare ? 'Thử thách' : 'Sự thật'}</small>
      </span>
    );
  }

  if (gameType === 'group_lucky_wheel') {
    if (!value) {
      return (
        <span className="treasure-unopened" aria-hidden="true">
          🎁
        </span>
      );
    }
    if (value === 50) {
      return (
        <span className="treasure-tile tile-diamond">
          <span>👑</span>
          <small>+50đ</small>
        </span>
      );
    }
    if (value === 30) {
      return (
        <span className="treasure-tile tile-diamond">
          <span>💎</span>
          <small>+30đ</small>
        </span>
      );
    }
    if (value === 15) {
      return (
        <span className="treasure-tile tile-gold">
          <span>🧧</span>
          <small>+15đ</small>
        </span>
      );
    }
    if (value === 10) {
      return (
        <span className="treasure-tile tile-gold">
          <span>🍀</span>
          <small>+10đ</small>
        </span>
      );
    }
    if (value === -15) {
      return (
        <span className="treasure-tile tile-bomb">
          <span>🌀</span>
          <small>-15đ</small>
        </span>
      );
    }
    return (
      <span className="treasure-tile tile-radar">
        <span>🐸</span>
        <small>0đ</small>
      </span>
    );
  }

  if (gameType === 'group_spy_hunt') {
    if (!value) {
      return (
        <span className="treasure-unopened" aria-hidden="true">
          🏢
        </span>
      );
    }
    if (value === 30) {
      return (
        <span className="treasure-tile tile-diamond">
          <span>🕵️</span>
          <small>+5đ</small>
        </span>
      );
    }
    if (value === 20) {
      return (
        <span className="treasure-tile tile-gold">
          <span>📂</span>
          <small>+2đ</small>
        </span>
      );
    }
    if (value === -10) {
      return (
        <span className="treasure-tile tile-bomb">
          <span>🚨</span>
          <small>-2đ</small>
        </span>
      );
    }
    const clue = Math.max(0, value - 10);
    return (
      <span className={`treasure-tile tile-radar radar-${clue}`}>
        <strong>{clue}</strong>
        <small>tình báo</small>
      </span>
    );
  }

  if (gameType === 'memory_match') {
    if (!value) {
      return (
        <span className="memory-card-back" aria-hidden="true">
          ✦
        </span>
      );
    }
    const iconId = value > 10 ? value - 10 : value;
    const item = MEMORY_ICONS[iconId] ?? { emoji: '⭐', label: 'Thẻ' };
    return (
      <span
        className={`memory-card-face ${value <= 8 ? 'is-matched' : 'is-temp'}`}
      >
        <span className="memory-emoji" aria-hidden="true">
          {item.emoji}
        </span>
        <small>{item.label}</small>
      </span>
    );
  }

  if (gameType === 'treasure_hunt') {
    if (!value) {
      return (
        <span className="treasure-unopened" aria-hidden="true">
          ⛏️
        </span>
      );
    }
    if (value === 30) {
      return (
        <span className="treasure-tile tile-diamond">
          <span>💎</span>
          <small>+4đ</small>
        </span>
      );
    }
    if (value === 20) {
      return (
        <span className="treasure-tile tile-gold">
          <span>💰</span>
          <small>+2đ</small>
        </span>
      );
    }
    if (value === -10) {
      return (
        <span className="treasure-tile tile-bomb">
          <span>💣</span>
          <small>-2đ</small>
        </span>
      );
    }
    const clue = Math.max(0, value - 10);
    return (
      <span className={`treasure-tile tile-radar radar-${clue}`}>
        <strong>{clue}</strong>
        <small>kho báu</small>
      </span>
    );
  }

  if (gameType === 'sudoku_duel') {
    if (!value) {
      return <span className="sudoku-empty-mark">?</span>;
    }
    const num = value > 20 ? value - 20 : value > 10 ? value - 10 : value;
    const solver = value > 20 ? 'o' : value > 10 ? 'x' : 'given';
    return <span className={`sudoku-cell-num solver-${solver}`}>{num}</span>;
  }

  if (!value) return null;

  if (gameType === 'connect_four' || gameType === 'othello') {
    return (
      <span className="c4-disc" aria-hidden="true">
        ●
      </span>
    );
  }

  if (gameType === 'xiangqi') {
    const piece = XIANGQI_PIECES[value];
    if (!piece) return null;
    const isRed = value > 0;
    return (
      <span
        className={`xiangqi-token ${isRed ? 'xq-red' : 'xq-black'}`}
        title={piece.name}
      >
        <strong className="xq-hanzi">{piece.hanzi}</strong>
        <small className="xq-viet">{piece.viet}</small>
      </span>
    );
  }

  if (gameType === 'chess') {
    const piece = CHESS_PIECES[value];
    if (!piece) return null;
    const isWhite = value > 0;
    return (
      <span
        className={`chess-token ${isWhite ? 'chess-white' : 'chess-black'}`}
        title={piece.name}
      >
        <span className="chess-glyph" aria-hidden="true">
          {piece.glyph}
        </span>
        <small className="chess-label">{piece.short}</small>
      </span>
    );
  }

  if (gameType === 'checkers') {
    const isRed = value > 0;
    const isKing = Math.abs(value) === 2;
    return (
      <span
        className={`checkers-token ${isRed ? 'ck-red' : 'ck-black'}${
          isKing ? ' ck-king' : ''
        }`}
      >
        {isKing && <Crown size={14} aria-hidden="true" />}
      </span>
    );
  }

  if (gameType === 'co_ganh') {
    return (
      <span
        className={`ganh-token ${value === 1 ? 'ganh-red' : 'ganh-blue'}`}
      />
    );
  }

  return (
    <span className="board-glyph">
      {value === 1 ? 'X' : value === 2 ? 'O' : ''}
    </span>
  );
}

function XiangqiBoardOverlay() {
  return (
    <svg
      className="board-svg-overlay xiangqi-overlay"
      viewBox="0 0 900 1000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect
        x="50"
        y="50"
        width="800"
        height="900"
        fill="none"
        stroke="#7a5230"
        strokeWidth="5"
      />
      {Array.from({ length: 10 }, (_, r) => (
        <line
          key={`h-${r}`}
          x1="50"
          y1={50 + r * 100}
          x2="850"
          y2={50 + r * 100}
          stroke="#8c6239"
          strokeWidth="2.5"
        />
      ))}
      {Array.from({ length: 7 }, (_, i) => {
        const x = 150 + i * 100;
        return (
          <g key={`v-${i}`}>
            <line
              x1={x}
              y1="50"
              x2={x}
              y2="450"
              stroke="#8c6239"
              strokeWidth="2.5"
            />
            <line
              x1={x}
              y1="550"
              x2={x}
              y2="950"
              stroke="#8c6239"
              strokeWidth="2.5"
            />
          </g>
        );
      })}
      <line
        x1="350"
        y1="50"
        x2="550"
        y2="250"
        stroke="#8c6239"
        strokeWidth="2.5"
      />
      <line
        x1="550"
        y1="50"
        x2="350"
        y2="250"
        stroke="#8c6239"
        strokeWidth="2.5"
      />
      <line
        x1="350"
        y1="750"
        x2="550"
        y2="950"
        stroke="#8c6239"
        strokeWidth="2.5"
      />
      <line
        x1="550"
        y1="750"
        x2="350"
        y2="950"
        stroke="#8c6239"
        strokeWidth="2.5"
      />
      <rect x="53" y="452" width="794" height="96" fill="#dfbe8a" />
      <text
        x="250"
        y="512"
        textAnchor="middle"
        fill="#6e4726"
        fontSize="34"
        fontWeight="700"
      >
        楚 河 · SỞ HÀ
      </text>
      <text
        x="650"
        y="512"
        textAnchor="middle"
        fill="#6e4726"
        fontSize="34"
        fontWeight="700"
      >
        HÁN GIỚI · 漢 界
      </text>
    </svg>
  );
}

function CoGanhBoardOverlay() {
  return (
    <svg
      className="board-svg-overlay coganh-overlay"
      viewBox="0 0 500 500"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: 5 }, (_, i) => {
        const pos = 50 + i * 100;
        return (
          <g key={i}>
            <line
              x1="50"
              y1={pos}
              x2="450"
              y2={pos}
              stroke="#8c6239"
              strokeWidth="3"
            />
            <line
              x1={pos}
              y1="50"
              x2={pos}
              y2="450"
              stroke="#8c6239"
              strokeWidth="3"
            />
          </g>
        );
      })}
      <line
        x1="50"
        y1="50"
        x2="450"
        y2="450"
        stroke="#8c6239"
        strokeWidth="3"
      />
      <line
        x1="450"
        y1="50"
        x2="50"
        y2="450"
        stroke="#8c6239"
        strokeWidth="3"
      />
      <line
        x1="250"
        y1="50"
        x2="50"
        y2="250"
        stroke="#8c6239"
        strokeWidth="3"
      />
      <line
        x1="250"
        y1="50"
        x2="450"
        y2="250"
        stroke="#8c6239"
        strokeWidth="3"
      />
      <line
        x1="50"
        y1="250"
        x2="250"
        y2="450"
        stroke="#8c6239"
        strokeWidth="3"
      />
      <line
        x1="450"
        y1="250"
        x2="250"
        y2="450"
        stroke="#8c6239"
        strokeWidth="3"
      />
    </svg>
  );
}

function GameMiniIllustration({ gameType }: { gameType: GameType }) {
  if (gameType === 'group_bomb_pass') {
    return (
      <div className="game-catalog-symbol symbol-pirate" aria-hidden="true">
        <div className="mini-pirate-icon">
          <span>💣</span>
          <small>✂️⚡</small>
        </div>
      </div>
    );
  }
  if (gameType === 'group_truth_dare') {
    return (
      <div className="game-catalog-symbol symbol-rps" aria-hidden="true">
        <div className="mini-rps-icons">
          <span>💬</span>
          <span>🔥</span>
        </div>
      </div>
    );
  }
  if (gameType === 'group_lucky_wheel') {
    return (
      <div className="game-catalog-symbol symbol-memory" aria-hidden="true">
        <div className="mini-grid-memory">
          <span>👑</span>
          <span>🧧</span>
          <span>🍀</span>
          <span>💎</span>
        </div>
      </div>
    );
  }
  if (gameType === 'group_spy_hunt') {
    return (
      <div className="game-catalog-symbol symbol-treasure" aria-hidden="true">
        <div className="mini-grid-treasure">
          <span>🕵️</span>
          <span>📡</span>
          <span>📂</span>
          <span>🚨</span>
        </div>
      </div>
    );
  }
  if (gameType === 'group_heist_vault') {
    return (
      <div className="game-catalog-symbol symbol-sudoku" aria-hidden="true">
        <div className="mini-grid-sudoku">
          <span>🔒</span>
          <span>🔓</span>
          <span>▲</span>
          <span>▼</span>
        </div>
      </div>
    );
  }
  if (gameType === 'group_quiz_arena') {
    return (
      <div className="game-catalog-symbol symbol-c4" aria-hidden="true">
        <div className="mini-pirate-icon">
          <span>🧠</span>
          <small style={{ color: '#ffd43b', fontWeight: 800 }}>A·B·C</small>
        </div>
      </div>
    );
  }
  if (gameType === 'memory_match') {
    return (
      <div className="game-catalog-symbol symbol-memory" aria-hidden="true">
        <div className="mini-grid-memory">
          <span>🦊</span>
          <span className="down">✦</span>
          <span className="down">✦</span>
          <span>🦊</span>
        </div>
      </div>
    );
  }
  if (gameType === 'treasure_hunt') {
    return (
      <div className="game-catalog-symbol symbol-treasure" aria-hidden="true">
        <div className="mini-grid-treasure">
          <span>💎</span>
          <span>2</span>
          <span>💣</span>
          <span>💰</span>
        </div>
      </div>
    );
  }
  if (gameType === 'rps_showdown') {
    return (
      <div className="game-catalog-symbol symbol-rps" aria-hidden="true">
        <div className="mini-rps-icons">
          <span>✊</span>
          <span>✌️</span>
        </div>
      </div>
    );
  }
  if (gameType === 'pirate_roulette') {
    return (
      <div className="game-catalog-symbol symbol-pirate" aria-hidden="true">
        <div className="mini-pirate-icon">
          <span>🏴‍☠️</span>
          <small>🗡️🛢️</small>
        </div>
      </div>
    );
  }
  if (gameType === 'sudoku_duel') {
    return (
      <div className="game-catalog-symbol symbol-sudoku" aria-hidden="true">
        <div className="mini-grid-sudoku">
          <span>1</span>
          <span className="q">?</span>
          <span>3</span>
          <span>4</span>
        </div>
      </div>
    );
  }
  if (gameType === 'xiangqi') {
    return (
      <div className="game-catalog-symbol symbol-xiangqi" aria-hidden="true">
        <div className="mini-xq-board">
          <span className="xq-mini-token red">帥</span>
          <span className="xq-mini-token black">將</span>
          <span className="xq-mini-token black">車</span>
          <span className="xq-mini-token red">炮</span>
        </div>
      </div>
    );
  }
  if (gameType === 'chess') {
    return (
      <div className="game-catalog-symbol symbol-chess" aria-hidden="true">
        <div className="mini-grid-chess">
          <span className="light">♔</span>
          <span className="dark">♟</span>
          <span className="light">♘</span>
          <span className="dark">♛</span>
        </div>
      </div>
    );
  }
  if (gameType === 'othello') {
    return (
      <div className="game-catalog-symbol symbol-othello" aria-hidden="true">
        <div className="mini-grid-othello">
          <span className="white" />
          <span className="black" />
          <span className="black" />
          <span className="white" />
        </div>
      </div>
    );
  }
  if (gameType === 'checkers') {
    return (
      <div className="game-catalog-symbol symbol-checkers" aria-hidden="true">
        <div className="mini-grid-checkers">
          <span className="sq-l" />
          <span className="sq-d red" />
          <span className="sq-d black" />
          <span className="sq-l" />
        </div>
      </div>
    );
  }
  if (gameType === 'co_ganh') {
    return (
      <div className="game-catalog-symbol symbol-coganh" aria-hidden="true">
        <div className="mini-grid-coganh">
          <span className="blue" />
          <span className="red" />
          <span className="blue" />
        </div>
      </div>
    );
  }
  if (gameType === 'caro') {
    return (
      <div className="game-catalog-symbol symbol-caro" aria-hidden="true">
        <div className="mini-grid-caro">
          <span>X</span>
          <span>O</span>
          <span className="win">X</span>
          <span>O</span>
          <span className="win">X</span>
          <span />
          <span className="win">X</span>
          <span>O</span>
          <span />
        </div>
      </div>
    );
  }
  if (gameType === 'tic_tac_toe') {
    return (
      <div className="game-catalog-symbol symbol-ttt" aria-hidden="true">
        <div className="mini-grid-ttt">
          <span className="x">X</span>
          <span className="o">O</span>
          <span className="x">X</span>
          <span />
          <span className="x">X</span>
          <span className="o">O</span>
          <span className="x">X</span>
          <span />
          <span className="o">O</span>
        </div>
      </div>
    );
  }
  return (
    <div className="game-catalog-symbol symbol-c4" aria-hidden="true">
      <div className="mini-grid-c4">
        <span className="empty" />
        <span className="empty" />
        <span className="gold" />
        <span className="empty" />
        <span className="coral" />
        <span className="gold" />
        <span className="coral" />
        <span className="gold" />
        <span className="gold" />
      </div>
    </div>
  );
}

function GameCatalog({
  busy,
  isGroup,
  previousGame,
  onBackToPrevious,
  onInvite,
}: {
  busy: boolean;
  isGroup?: boolean;
  previousGame?: CaroSession | null;
  onBackToPrevious?: () => void;
  onInvite: (type: GameType) => void;
}) {
  const [category, setCategory] = useState<GameCategory>('all');
  const entries = (
    Object.entries(GAME_INFO) as [GameType, (typeof GAME_INFO)[GameType]][]
  ).filter(
    ([, meta]) =>
      Boolean(meta.groupOnly) === Boolean(isGroup) &&
      (category === 'all' || meta.category === category),
  );

  const categoryTabs: readonly (readonly [GameCategory, string])[] = isGroup
    ? [
        ['all', 'Tất cả trò chơi nhóm (6)'],
        ['group_party', '🎉 Khuấy động tiệc nhóm (3)'],
        ['group_deduction', '🕵️ Suy luận & Mật mã (2)'],
        ['group_brain', '🧠 Đấu trí tập thể (1)'],
      ]
    : [
        ['all', 'Tất cả (13)'],
        ['party_adventure', '🎉 Tiệc tùng & Phiêu lưu (3)'],
        ['puzzle_memory', '🧠 Trí nhớ & Giải đố (2)'],
        ['strategy', '♟️ Cờ chiến thuật (4)'],
        ['board_line', '⭕ Xếp quân & Lật cờ (4)'],
      ];

  return (
    <div className="game-empty">
      <div className="game-catalog-banner">
        <div>
          <h3>
            {isGroup
              ? '6 Trò chơi tiệc tùng & đấu trí dành riêng cho Nhóm'
              : '13 Trò chơi đa thể loại trực tiếp trong chat 1-1'}
          </h3>
          <p>
            {isGroup
              ? 'Chuyền bom hẹn giờ, Sự thật hay Thử thách, Đua nhân phẩm, Truy tìm gián điệp, Phá két sắt và Đấu trường đố vui — mọi thành viên trong nhóm đều có thể tham gia!'
              : 'Phiêu lưu săn kho báu, lật thẻ trí nhớ, oẳn tù tì tâm lý, đâm thùng hải tặc, giải đố Sudoku hay đấu cờ chiến thuật — đồng bộ thời gian thực giữa hai người bạn!'}
          </p>
        </div>
        {previousGame && onBackToPrevious && (
          <button
            type="button"
            className="game-secondary game-return-btn"
            onClick={onBackToPrevious}
          >
            Xem lại ván vừa đấu
          </button>
        )}
      </div>

      {isGroup && (
        <div className="game-group-notice" role="note">
          <Users size={18} aria-hidden="true" />
          <span>
            Đang ở <strong>chế độ Trò chuyện Nhóm</strong>: Chỉ hiển thị các trò
            chơi dành riêng cho nhóm. Bất kỳ thành viên nào trong nhóm cũng có
            thể bấm tham gia và đi lượt tiếp theo!
          </span>
        </div>
      )}

      <div className="game-catalog-toolbar">
        <div
          className="game-category-tabs"
          role="tablist"
          aria-label="Phân loại trò chơi"
        >
          {categoryTabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={category === key}
              className={category === key ? 'is-active' : ''}
              onClick={() => setCategory(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="game-catalog">
        {entries.map(([type, item]) => (
          <article className={`game-catalog-card game-${type}`} key={type}>
            <div className="game-card-top">
              <GameMiniIllustration gameType={type} />
              <div className="game-invite-copy">
                <div className="game-card-title-row">
                  <h3>{item.name}</h3>
                  <span className="game-card-badge">{item.badge}</span>
                </div>
                <p>{item.description}</p>
              </div>
            </div>
            <button
              type="button"
              className="game-primary game-invite-btn"
              disabled={busy}
              onClick={() => onInvite(type)}
            >
              {busy ? 'Đang gửi…' : isGroup ? 'Mở bàn nhóm' : 'Mời chơi'}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
