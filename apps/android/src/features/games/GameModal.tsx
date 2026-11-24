import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import * as api from '../../api';
import { acquireChatSocket } from '../../realtime';
import {
  GAME_ICON_MAP,
  GAME_INFO,
  TRUTH_DARE_PROMPTS,
  findWinningCells,
  getDefaultTurnLimitSeconds,
  getOthelloFlips,
  getPlayerBadgeIcon,
  getValidTargetsForPiece,
  isOwnCell,
  type CaroSession,
  type GameCategory,
  type GameType,
} from './game-rules';
import {
  GridBoardStage,
  GroupBombPassStage,
  GroupHeistVaultStage,
  GroupQuizArenaStage,
  PirateRouletteStage,
  RpsShowdownStage,
} from './GameStages';
import { gameStyles as s } from './gameStyles';

export function GameModal({
  visible,
  conversationId,
  userId,
  names,
  isGroup = false,
  onClose,
  onExpired,
  onGameChange,
}: {
  visible: boolean;
  conversationId: string;
  userId: string;
  names: (id: string) => string;
  isGroup?: boolean;
  onClose: () => void;
  onExpired: () => void;
  onGameChange?: (game: CaroSession | null) => void;
}) {
  const [game, setGame] = useState<CaroSession | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [browsingCatalog, setBrowsingCatalog] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [lastMoveCells, setLastMoveCells] = useState<Set<number>>(new Set());
  const prevBoardRef = useRef<{ gameId: string; board: number[] } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(45);
  const turnDeadlineRef = useRef(0);
  const timeoutClaimedKeyRef = useRef('');

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
            if ((prev.board[i] ?? 0) !== (next.board[i] ?? 0)) changed.add(i);
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
      const res = await api.authenticated<{ game: CaroSession | null }>(
        `/conversations/${conversationId}/games/current`,
      );
      updateGameState(res.game);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) onExpired();
      else setError(api.errorMessage(e));
    }
  }, [conversationId, onExpired, updateGameState]);

  useEffect(() => {
    if (!visible) return;
    setError('');
    void load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) return;
    const socket = acquireChatSocket(onExpired);
    const offUpdate = socket.on(
      'game:updated',
      (result?: { game?: CaroSession }) => {
        if (result?.game?.conversationId === conversationId) {
          updateGameState(result.game);
        }
      },
    );
    return () => {
      offUpdate();
      socket.release();
    };
  }, [visible, conversationId, onExpired, updateGameState]);

  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      const res = await api.authenticated<{ game: CaroSession }>(
        path,
        body,
        'POST',
      );
      updateGameState(res.game);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) onExpired();
      else setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const myMark: 'X' | 'O' = game?.xUserId === userId ? 'X' : 'O';
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

  useEffect(() => {
    if (!visible || !game || game.status !== 'active') return;
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
    setRemainingSeconds(
      Math.max(0, Math.min(limitSec, Math.ceil((deadline - now) / 1000))),
    );

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
          .then(res => {
            if (res.game) updateGameState(res.game);
          })
          .catch(() => {});
      }
    }, 300);
    return () => clearInterval(interval);
  }, [
    visible,
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

  const scoreMetrics = useMemo(() => {
    if (!game) return null;
    const b = game.board ?? [];
    if (game.gameType === 'memory_match')
      return { x: `${b[16] ?? 0} cặp`, o: `${b[17] ?? 0} cặp` };
    if (game.gameType === 'treasure_hunt')
      return { x: `${b[36] ?? 0}đ`, o: `${b[37] ?? 0}đ` };
    if (game.gameType === 'rps_showdown')
      return { x: `${b[0] ?? 0} thắng`, o: `${b[1] ?? 0} thắng` };
    if (game.gameType === 'pirate_roulette')
      return { x: `${b[20] ?? 0} vàng`, o: `${b[21] ?? 0} vàng` };
    if (
      game.gameType === 'sudoku_duel' ||
      game.gameType === 'group_bomb_pass' ||
      game.gameType === 'group_lucky_wheel'
    )
      return { x: `${b[16] ?? 0}đ`, o: `${b[17] ?? 0}đ` };
    if (
      game.gameType === 'group_truth_dare' ||
      game.gameType === 'group_heist_vault'
    )
      return { x: `${b[12] ?? 0}đ`, o: `${b[13] ?? 0}đ` };
    if (game.gameType === 'group_spy_hunt')
      return { x: `${b[25] ?? 0}đ`, o: `${b[26] ?? 0}đ` };
    if (game.gameType === 'group_quiz_arena')
      return { x: `${b[0] ?? 0}đ`, o: `${b[1] ?? 0}đ` };
    if (game.gameType === 'othello' || game.gameType === 'co_ganh') {
      return {
        x: `${b.filter(v => v === 1).length} quân`,
        o: `${b.filter(v => v === 2).length} quân`,
      };
    }
    if (
      game.gameType === 'checkers' ||
      game.gameType === 'chess' ||
      game.gameType === 'xiangqi'
    ) {
      return {
        x: `${b.filter(v => v > 0).length} quân`,
        o: `${b.filter(v => v < 0).length} quân`,
      };
    }
    return null;
  }, [game]);

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

  const statusHeadline = useMemo(() => {
    if (!game) return '';
    if (game.status === 'invited') {
      if (info?.groupOnly) {
        return game.xUserId === userId
          ? 'Đang chờ các thành viên trong nhóm tham gia bàn chơi…'
          : `${names(game.xUserId)} vừa mở bàn ${info.name} cho cả nhóm!`;
      }
      return game.xUserId === userId
        ? `Đang chờ ${names(game.oUserId)} chấp nhận lời mời…`
        : `${names(game.xUserId)} mời bạn chơi ${info?.name}`;
    }
    if (game.status === 'active') {
      if (myTurn) {
        if (game.gameType === 'sudoku_duel') {
          return selectedFrom !== null
            ? 'Chọn số 1–4 bên dưới để điền vào ô!'
            : 'Đến lượt bạn · Chạm vào ô (?) để giải mã!';
        }
        if (info?.stepMove) {
          return selectedFrom !== null
            ? 'Chạm vào ô xanh để di chuyển quân'
            : 'Đến lượt bạn · Chạm vào quân cờ để đi';
        }
        return 'Đến lượt bạn đi!';
      }
      return `Đang chờ ${names(opponentId)} đi lượt…`;
    }
    if (game.status === 'draw') return 'Bất phân thắng bại — Ván đấu hòa!';
    if (game.status === 'declined')
      return 'Lời mời chơi đã được hủy hoặc từ chối';
    const isTimeout =
      game.status === 'forfeited' &&
      (game.forfeitReason === 'timeout' || remainingSeconds === 0);
    if (game.winnerId === userId) {
      if (isTimeout)
        return `Hết giờ! ${names(opponentId)} quá thời gian — Bạn thắng!`;
      if (game.status === 'forfeited')
        return `Bạn thắng do ${names(opponentId)} đầu hàng!`;
      return 'Tuyệt vời! Bạn đã giành chiến thắng!';
    }
    if (isTimeout)
      return `Hết thời gian · ${names(game.winnerId ?? opponentId)} thắng`;
    if (game.status === 'forfeited')
      return `Bạn đã đầu hàng · ${names(game.winnerId ?? opponentId)} thắng`;
    return `${names(game.winnerId ?? opponentId)} đã chiến thắng ván này`;
  }, [
    game,
    info,
    myTurn,
    names,
    opponentId,
    remainingSeconds,
    selectedFrom,
    userId,
  ]);

  function handleCellPress(cell: number) {
    if (!game || !info || busy || !myTurn) return;
    if (game.gameType === 'sudoku_duel') {
      if ((game.board[cell] ?? 0) === 0) {
        setSelectedFrom(prev => (prev === cell ? null : cell));
      }
      return;
    }
    if (info.stepMove) {
      const value = game.board[cell] ?? 0;
      const own = isOwnCell(game.gameType, value, myMark);
      if (own) {
        setSelectedFrom(prev => (prev === cell ? null : cell));
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
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={s.modalPage}>
        <View style={s.header}>
          <View style={s.headerLeft}>
            {!showCatalog && isFinished && (
              <Pressable
                disabled={busy}
                onPress={() => {
                  setError('');
                  setBrowsingCatalog(true);
                }}
                style={s.backPill}
              >
                <Text style={s.backPillText}>← Chọn trò chơi khác</Text>
              </Pressable>
            )}
            <Text style={s.kicker}>🎮 PINGPONG ARCADE</Text>
            <Text numberOfLines={1} style={s.title}>
              {showCatalog ? 'Trung tâm trò chơi' : (info?.name ?? 'Trò chơi')}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Đóng trò chơi"
            onPress={onClose}
            style={s.closeBtn}
          >
            <Text style={s.closeBtnText}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.bodyContent} style={s.bodyScroll}>
          {!!error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable onPress={() => setError('')}>
                <Text style={s.errorText}>✕</Text>
              </Pressable>
            </View>
          )}

          {game === undefined ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color="#b75020" size="large" />
              <Text style={s.loadingText}>Đang tải sảnh trò chơi…</Text>
            </View>
          ) : showCatalog ? (
            <GameCatalog
              busy={busy}
              isGroup={isGroup}
              previousGame={isFinished ? game : null}
              onBackToPrevious={() => setBrowsingCatalog(false)}
              onInvite={gameType =>
                void action(`/conversations/${conversationId}/games`, {
                  gameType,
                })
              }
            />
          ) : (
            <>
              <View style={s.matchupBar}>
                <View
                  style={[
                    s.playerCard,
                    game.status === 'active' &&
                      game.turn === 'X' &&
                      s.playerCardActive,
                    game.winnerId === game.xUserId && s.playerCardWinner,
                  ]}
                >
                  <View style={[s.playerToken, s.playerTokenX]}>
                    <Text style={s.playerTokenText}>
                      {getPlayerBadgeIcon(game.gameType, 'X')}
                    </Text>
                  </View>
                  <View style={s.playerMeta}>
                    <Text numberOfLines={1} style={s.playerName}>
                      {xPlayerName}
                      {game.winnerId === game.xUserId ? ' 👑' : ''}
                    </Text>
                    <Text numberOfLines={1} style={s.playerSub}>
                      {scoreMetrics
                        ? scoreMetrics.x
                        : game.status === 'active' && game.turn === 'X'
                          ? 'Đang đi'
                          : 'Chờ lượt'}
                    </Text>
                  </View>
                </View>

                <View style={s.vsWrap}>
                  <Text style={s.vsBadge}>VS</Text>
                  <Text style={s.vsMoves}>{game.moveCount} lượt</Text>
                </View>

                <View
                  style={[
                    s.playerCard,
                    game.status === 'active' &&
                      game.turn === 'O' &&
                      s.playerCardActive,
                    game.winnerId === game.oUserId && s.playerCardWinner,
                  ]}
                >
                  <View style={s.playerMeta}>
                    <Text
                      numberOfLines={1}
                      style={[s.playerName, { textAlign: 'right' }]}
                    >
                      {game.winnerId === game.oUserId ? '👑 ' : ''}
                      {oPlayerName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[s.playerSub, { textAlign: 'right' }]}
                    >
                      {scoreMetrics
                        ? scoreMetrics.o
                        : game.status === 'active' && game.turn === 'O'
                          ? 'Đang đi'
                          : 'Chờ lượt'}
                    </Text>
                  </View>
                  <View style={[s.playerToken, s.playerTokenO]}>
                    <Text style={s.playerTokenText}>
                      {getPlayerBadgeIcon(game.gameType, 'O')}
                    </Text>
                  </View>
                </View>
              </View>

              {game.status === 'active' && (
                <View
                  style={[
                    s.clockBox,
                    remainingSeconds <= 8
                      ? s.clockBoxDanger
                      : remainingSeconds <= 15
                        ? s.clockBoxWarning
                        : undefined,
                  ]}
                >
                  <View style={s.clockTop}>
                    <Text style={s.clockLabel}>
                      ⏱{' '}
                      {myTurn
                        ? 'Thời gian của bạn'
                        : `Thời gian của ${names(opponentId)}`}
                    </Text>
                    <Text
                      style={[
                        s.clockValue,
                        remainingSeconds <= 8 && s.clockValueDanger,
                      ]}
                    >
                      {remainingSeconds}s / {turnLimitSeconds}s
                    </Text>
                  </View>
                  <View style={s.clockTrack}>
                    <View
                      style={[
                        s.clockFill,
                        remainingSeconds <= 8
                          ? s.clockFillDanger
                          : remainingSeconds <= 15
                            ? s.clockFillWarning
                            : undefined,
                        {
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              (remainingSeconds / turnLimitSeconds) * 100,
                            ),
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              <View
                style={[
                  s.statusBanner,
                  myTurn && s.statusBannerMyTurn,
                  game.winnerId === userId && s.statusBannerWin,
                ]}
              >
                <Text style={s.statusText}>{statusHeadline}</Text>
                {info && (
                  <Text style={s.winRuleText}>Luật thắng: {info.winRule}</Text>
                )}
              </View>

              {game.status === 'invited' && (
                <View style={s.inviteCard}>
                  <Text style={s.inviteEmoji}>
                    {GAME_ICON_MAP[game.gameType]}
                  </Text>
                  <Text style={s.inviteTitle}>{info?.name}</Text>
                  <Text style={s.inviteDesc}>{info?.description}</Text>
                  {(
                    info?.groupOnly
                      ? game.xUserId !== userId
                      : game.oUserId === userId
                  ) ? (
                    <View style={s.actionRow}>
                      <Pressable
                        disabled={busy}
                        onPress={() => void action(`/games/${game.id}/decline`)}
                        style={[
                          s.secondaryBtn,
                          s.actionFlex,
                          busy && s.disabledBtn,
                        ]}
                      >
                        <Text style={s.secondaryBtnText}>Từ chối</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() => void action(`/games/${game.id}/accept`)}
                        style={[
                          s.primaryBtn,
                          s.actionFlex,
                          busy && s.disabledBtn,
                        ]}
                      >
                        <Text style={s.primaryBtnText}>
                          {info?.groupOnly ? 'Tham gia nhóm' : 'Chấp nhận'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      disabled={busy}
                      onPress={() => void action(`/games/${game.id}/decline`)}
                      style={[
                        s.secondaryBtn,
                        { width: '100%' },
                        busy && s.disabledBtn,
                      ]}
                    >
                      <Text style={s.secondaryBtnText}>
                        Hủy lời mời / Đổi trò chơi
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              {game.status === 'declined' && (
                <View style={s.inviteCard}>
                  <Text style={s.inviteDesc}>
                    Ván {info?.name} chưa bắt đầu. Bạn có thể mời lại hoặc chọn
                    trò chơi khác!
                  </Text>
                  <View style={s.actionRow}>
                    <Pressable
                      disabled={busy}
                      onPress={() => setBrowsingCatalog(true)}
                      style={[s.secondaryBtn, s.actionFlex]}
                    >
                      <Text style={s.secondaryBtnText}>Đổi trò chơi</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        void action(`/conversations/${conversationId}/games`, {
                          gameType: game.gameType,
                        })
                      }
                      style={[
                        s.primaryBtn,
                        s.actionFlex,
                        busy && s.disabledBtn,
                      ]}
                    >
                      <Text style={s.primaryBtnText}>Mời lại</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {['active', 'won', 'draw', 'forfeited'].includes(game.status) && (
                <>
                  {game.gameType === 'group_truth_dare' && (
                    <View style={s.truthDareCard}>
                      {(game.board[14] ?? 0) > 0 &&
                      TRUTH_DARE_PROMPTS[game.board[14]!] ? (
                        <>
                          <Text style={s.truthDareBadge}>
                            {TRUTH_DARE_PROMPTS[game.board[14]!]!.badge} ·{' '}
                            {(game.board[15] ?? 1) === 1
                              ? xPlayerName
                              : oPlayerName}
                          </Text>
                          <Text style={s.truthDareText}>
                            {TRUTH_DARE_PROMPTS[game.board[14]!]!.text}
                          </Text>
                        </>
                      ) : (
                        <Text style={s.truthDareText}>
                          💌 Mở một phong bì bên dưới để nhận câu hỏi Sự Thật
                          (+15đ) hoặc Thử Thách (+25đ)!
                        </Text>
                      )}
                    </View>
                  )}

                  {game.gameType === 'group_lucky_wheel' && (
                    <View style={s.helperBar}>
                      <Text style={s.helperItem}>👑 +50đ</Text>
                      <Text style={s.helperItem}>💎 +30đ</Text>
                      <Text style={s.helperItem}>🧧 +15đ</Text>
                      <Text style={s.helperItem}>🍀 +10đ</Text>
                      <Text style={s.helperItem}>🌀 -15đ</Text>
                      <Text style={s.helperItem}>Lượt {game.moveCount}/10</Text>
                    </View>
                  )}

                  {game.gameType === 'group_spy_hunt' && (
                    <View style={s.helperBar}>
                      <Text style={s.helperItem}>🕵️ +5đ</Text>
                      <Text style={s.helperItem}>📂 +2đ</Text>
                      <Text style={s.helperItem}>🚨 -2đ</Text>
                      <Text style={s.helperItem}>
                        Còn {game.board[27] ?? 0} mục tiêu
                      </Text>
                    </View>
                  )}

                  {game.gameType === 'treasure_hunt' && (
                    <View style={s.helperBar}>
                      <Text style={s.helperItem}>💎 +4đ</Text>
                      <Text style={s.helperItem}>💰 +2đ</Text>
                      <Text style={s.helperItem}>💣 -2đ</Text>
                      <Text style={s.helperItem}>
                        Còn {game.board[38] ?? 0} kho báu
                      </Text>
                    </View>
                  )}

                  {game.gameType === 'rps_showdown' ? (
                    <RpsShowdownStage
                      busy={busy}
                      game={game}
                      myTurn={myTurn}
                      oPlayerName={oPlayerName}
                      onPickHand={handIdx =>
                        void action(`/games/${game.id}/moves`, {
                          cell: handIdx,
                        })
                      }
                      xPlayerName={xPlayerName}
                    />
                  ) : game.gameType === 'pirate_roulette' ? (
                    <PirateRouletteStage
                      busy={busy}
                      game={game}
                      myTurn={myTurn}
                      onStabSlot={slot =>
                        void action(`/games/${game.id}/moves`, { cell: slot })
                      }
                    />
                  ) : game.gameType === 'group_bomb_pass' ? (
                    <GroupBombPassStage
                      busy={busy}
                      game={game}
                      myTurn={myTurn}
                      onCutWire={wire =>
                        void action(`/games/${game.id}/moves`, { cell: wire })
                      }
                    />
                  ) : game.gameType === 'group_heist_vault' ? (
                    <GroupHeistVaultStage
                      busy={busy}
                      game={game}
                      myTurn={myTurn}
                      onCrackDigit={(lockIdx, digit) =>
                        void action(`/games/${game.id}/moves`, {
                          from: lockIdx,
                          cell: digit,
                        })
                      }
                    />
                  ) : game.gameType === 'group_quiz_arena' ? (
                    <GroupQuizArenaStage
                      busy={busy}
                      game={game}
                      myTurn={myTurn}
                      onAnswer={optIdx =>
                        void action(`/games/${game.id}/moves`, {
                          cell: optIdx,
                        })
                      }
                    />
                  ) : (
                    <GridBoardStage
                      busy={busy}
                      game={game}
                      lastMoveCells={lastMoveCells}
                      myMark={myMark}
                      myTurn={myTurn}
                      onCellPress={handleCellPress}
                      othelloValidMap={othelloValidMap}
                      selectedFrom={selectedFrom}
                      validStepTargets={validStepTargets}
                      winningCells={winningCells}
                    />
                  )}

                  {game.status === 'active' &&
                    game.gameType === 'sudoku_duel' && (
                      <View style={s.numpadBox}>
                        <Text style={s.numpadHint}>
                          {selectedFrom !== null
                            ? `Điền số cho hàng ${Math.floor(selectedFrom / 4) + 1}, cột ${(selectedFrom % 4) + 1}:`
                            : 'Chọn 1 ô (?) trên bảng rồi bấm số:'}
                        </Text>
                        <View style={s.numpadRow}>
                          {[1, 2, 3, 4].map(num => {
                            const disabled =
                              busy || !myTurn || selectedFrom === null;
                            return (
                              <Pressable
                                key={num}
                                disabled={disabled}
                                onPress={() => {
                                  if (selectedFrom === null) return;
                                  const target = selectedFrom;
                                  setSelectedFrom(null);
                                  void action(`/games/${game.id}/moves`, {
                                    from: target,
                                    cell: num,
                                  });
                                }}
                                style={[s.numpadBtn, disabled && s.disabledBtn]}
                              >
                                <Text style={s.numpadBtnText}>{num}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    )}

                  {game.status === 'active' &&
                    (!confirmForfeit ? (
                      <Pressable
                        disabled={busy}
                        onPress={() => setConfirmForfeit(true)}
                        style={s.secondaryBtn}
                      >
                        <Text style={s.secondaryBtnText}>🏳️ Xin đầu hàng</Text>
                      </Pressable>
                    ) : (
                      <View style={s.forfeitBox}>
                        <Text style={s.forfeitText}>
                          Bạn chắc chắn muốn nhận thua ván này?
                        </Text>
                        <View style={s.actionRow}>
                          <Pressable
                            disabled={busy}
                            onPress={() => setConfirmForfeit(false)}
                            style={[s.secondaryBtn, s.actionFlex]}
                          >
                            <Text style={s.secondaryBtnText}>Tiếp tục</Text>
                          </Pressable>
                          <Pressable
                            disabled={busy}
                            onPress={() =>
                              void action(`/games/${game.id}/forfeit`)
                            }
                            style={[
                              s.dangerBtn,
                              s.actionFlex,
                              busy && s.disabledBtn,
                            ]}
                          >
                            <Text style={s.dangerBtnText}>Đầu hàng</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}

                  {['won', 'draw', 'forfeited'].includes(game.status) && (
                    <View style={s.actionRow}>
                      <Pressable
                        disabled={busy}
                        onPress={() => {
                          setError('');
                          setBrowsingCatalog(true);
                        }}
                        style={[s.secondaryBtn, s.actionFlex]}
                      >
                        <Text style={s.secondaryBtnText}>Đổi trò chơi</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy}
                        onPress={() =>
                          void action(
                            `/conversations/${conversationId}/games`,
                            {
                              gameType: game.gameType,
                            },
                          )
                        }
                        style={[
                          s.primaryBtn,
                          s.actionFlex,
                          busy && s.disabledBtn,
                        ]}
                      >
                        <Text style={s.primaryBtnText}>Mời ván mới</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
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
        ['all', 'Tất cả nhóm (6)'],
        ['group_party', '🎉 Tiệc nhóm (3)'],
        ['group_deduction', '🕵️ Suy luận (2)'],
        ['group_brain', '🧠 Đấu trí (1)'],
      ]
    : [
        ['all', 'Tất cả (13)'],
        ['party_adventure', '🎉 Tiệc tùng (3)'],
        ['puzzle_memory', '🧠 Giải đố (2)'],
        ['strategy', '♟️ Chiến thuật (4)'],
        ['board_line', '⭕ Xếp quân (4)'],
      ];

  return (
    <>
      <View style={s.catalogBanner}>
        <Text style={s.catalogBannerTitle}>
          {isGroup
            ? '6 Trò chơi tiệc tùng & đấu trí dành cho Nhóm'
            : '13 Trò chơi trực tiếp trong chat 1-1'}
        </Text>
        <Text style={s.catalogBannerCopy}>
          {isGroup
            ? 'Chuyền bom hẹn giờ, Sự thật hay Thử thách, Đua nhân phẩm, Truy tìm gián điệp, Phá két sắt và Đấu trường đố vui.'
            : 'Đồng bộ thời gian thực giữa Android và Web — mời bạn bè vào bàn chơi ngay trong cuộc trò chuyện!'}
        </Text>
        {previousGame && onBackToPrevious && (
          <Pressable onPress={onBackToPrevious} style={s.secondaryBtn}>
            <Text style={s.secondaryBtnText}>Xem lại ván vừa đấu</Text>
          </Pressable>
        )}
      </View>

      {isGroup && (
        <View style={s.groupNotice}>
          <Text style={s.groupNoticeText}>
            Chế độ Trò chuyện Nhóm: Bất kỳ thành viên nào trong nhóm cũng có thể
            tham gia và đi lượt tiếp theo!
          </Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.categoryScroll}
        contentContainerStyle={s.categoryRow}
      >
        {categoryTabs.map(([key, label]) => {
          const active = category === key;
          return (
            <Pressable
              key={key}
              onPress={() => setCategory(key)}
              style={[s.categoryTab, active && s.categoryTabActive]}
            >
              <Text
                style={[s.categoryTabText, active && s.categoryTabTextActive]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.catalogList}>
        {entries.map(([type, item]) => (
          <View key={type} style={s.catalogCard}>
            <View style={s.catalogCardTop}>
              <View style={s.catalogIconBox}>
                <Text style={s.catalogIconText}>{GAME_ICON_MAP[type]}</Text>
              </View>
              <View style={s.catalogCardCopy}>
                <View style={s.catalogCardTitleRow}>
                  <Text style={s.catalogCardTitle}>{item.name}</Text>
                  <View style={s.catalogCardBadge}>
                    <Text style={s.catalogCardBadgeText}>{item.badge}</Text>
                  </View>
                </View>
                <Text style={s.catalogCardDesc}>{item.description}</Text>
              </View>
            </View>
            <Pressable
              disabled={busy}
              onPress={() => onInvite(type)}
              style={[s.primaryBtn, busy && s.disabledBtn]}
            >
              <Text style={s.primaryBtnText}>
                {busy ? 'Đang gửi…' : isGroup ? 'Mở bàn nhóm' : 'Mời chơi'}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>
    </>
  );
}
