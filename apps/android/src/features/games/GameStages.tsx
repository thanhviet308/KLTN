import React, { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import {
  CHESS_PIECES,
  GAME_INFO,
  GROUP_QUIZ_BANK,
  MEMORY_ICONS,
  RPS_HANDS,
  XIANGQI_PIECES,
  isOwnCell,
  type CaroSession,
  type GameType,
} from './game-rules';
import { gameStyles as s } from './gameStyles';

export function RpsShowdownStage({
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
    <View style={s.stageCard}>
      <View style={s.rpsStatusRow}>
        <View style={s.rpsFighter}>
          <Text numberOfLines={1} style={s.rpsFighterName}>
            {xPlayerName}
          </Text>
          <Text style={s.rpsFighterSub}>
            {xLocked
              ? '🔒 Đã khóa chiêu'
              : game.status === 'active' && game.turn === 'X'
                ? '⏳ Đang chọn…'
                : 'Sẵn sàng'}
          </Text>
        </View>
        <View style={s.rpsRoundBadge}>
          <Text style={s.rpsRoundText}>
            {game.status === 'active' ? `HIỆP ${currentRound}/5` : 'KẾT QUẢ'}
          </Text>
        </View>
        <View style={s.rpsFighter}>
          <Text numberOfLines={1} style={s.rpsFighterName}>
            {oPlayerName}
          </Text>
          <Text style={s.rpsFighterSub}>
            {game.status === 'active' && game.turn === 'O'
              ? '⚡ Đang ra chiêu…'
              : 'Chờ mở chiêu'}
          </Text>
        </View>
      </View>

      {game.status === 'active' && (
        <View style={s.rpsChoiceRow}>
          {[0, 1, 2].map(idx => {
            const hand = RPS_HANDS[idx + 1]!;
            return (
              <Pressable
                key={idx}
                disabled={busy || !myTurn}
                onPress={() => onPickHand(idx)}
                style={[s.rpsChoiceBtn, (busy || !myTurn) && s.disabledBtn]}
              >
                <Text style={s.rpsChoiceEmoji}>{hand.emoji}</Text>
                <Text style={s.rpsChoiceName}>{hand.name}</Text>
                <Text style={s.rpsChoiceDesc}>{hand.desc}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={s.rpsHistoryRow}>
        {Array.from({ length: 5 }, (_, i) => {
          const xHand = b[2 + i * 2] ?? 0;
          const oHand = b[2 + i * 2 + 1] ?? 0;
          const played = xHand > 0 && oHand > 0;
          return (
            <View key={i} style={s.rpsHistoryItem}>
              <Text style={s.rpsHistoryLabel}>H{i + 1}</Text>
              <Text style={s.rpsHistoryHands}>
                {played
                  ? `${RPS_HANDS[xHand]?.emoji ?? ''}·${RPS_HANDS[oHand]?.emoji ?? ''}`
                  : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function PirateRouletteStage({
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
    <View style={s.stageCard}>
      <View style={[s.heroBanner, popped && s.heroBannerExploded]}>
        <Text style={s.heroEmoji}>{popped ? '💥' : '🏴‍☠️'}</Text>
        <View style={s.heroCopy}>
          <Text style={s.heroTitle}>
            {popped
              ? 'BÙM! Hải Tặc đã bật tung khỏi thùng rượu!'
              : 'Thùng Rượu Hải Tặc (20 khe cắm kiếm)'}
          </Text>
          <Text style={s.heroSub}>
            {popped
              ? 'Khe bẫy đã bị kích hoạt!'
              : `Đã cắm ${game.moveCount}/20 thanh kiếm · Chỉ có 1 khe bẫy!`}
          </Text>
        </View>
      </View>

      <View style={s.slotGrid}>
        {Array.from({ length: 20 }, (_, slot) => {
          const val = b[slot] ?? 0;
          const isTrap = val === -9;
          const isBonus = val === 3 || val === 4;
          const isUsed = val !== 0;

          return (
            <Pressable
              key={slot}
              disabled={busy || !myTurn || isUsed}
              onPress={() => onStabSlot(slot)}
              style={[
                s.slotBtn,
                { width: '18%' },
                isUsed && s.slotBtnUsed,
                isBonus && s.slotBtnBonus,
                isTrap && s.slotBtnTrap,
                !isUsed && (!myTurn || busy) && s.disabledBtn,
              ]}
            >
              <Text style={s.slotIcon}>
                {isTrap ? '💥' : isBonus ? '🌟' : isUsed ? '🗡️' : '🕳️'}
              </Text>
              <Text numberOfLines={1} style={s.slotLabel}>
                {isTrap
                  ? 'BẪY!'
                  : isBonus
                    ? '+25'
                    : isUsed
                      ? 'OK'
                      : `#${slot + 1}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function GroupBombPassStage({
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
    <View style={s.stageCard}>
      <View style={[s.heroBanner, exploded && s.heroBannerExploded]}>
        <Text style={s.heroEmoji}>{exploded ? '💥' : '💣'}</Text>
        <View style={s.heroCopy}>
          <Text style={s.heroTitle}>
            {exploded
              ? 'BÙM! Dây ngòi nổ đã bị cắt!'
              : 'Bom Hẹn Giờ Nhóm (16 dây bí mật)'}
          </Text>
          <Text style={s.heroSub}>
            {exploded
              ? 'Ván chơi kết thúc do chạm trúng dây kích nổ!'
              : `Đã cắt ${game.moveCount}/16 dây · 4 dây thưởng (+25đ), 1 dây nổ!`}
          </Text>
        </View>
      </View>

      <View style={s.slotGrid}>
        {Array.from({ length: 16 }, (_, wire) => {
          const val = b[wire] ?? 0;
          const isTrap = val === -9;
          const isBonus = val === 3 || val === 4;
          const isUsed = val !== 0;

          return (
            <Pressable
              key={wire}
              disabled={busy || !myTurn || isUsed}
              onPress={() => onCutWire(wire)}
              style={[
                s.slotBtn,
                { width: '23%' },
                isUsed && s.slotBtnUsed,
                isBonus && s.slotBtnBonus,
                isTrap && s.slotBtnTrap,
                !isUsed && (!myTurn || busy) && s.disabledBtn,
              ]}
            >
              <Text style={s.slotIcon}>
                {isTrap ? '💥' : isBonus ? '⚡' : isUsed ? '✂️' : '🔌'}
              </Text>
              <Text numberOfLines={1} style={s.slotLabel}>
                {isTrap
                  ? 'NỔ!'
                  : isBonus
                    ? '+25đ'
                    : isUsed
                      ? '+10đ'
                      : `Dây #${wire + 1}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function GroupHeistVaultStage({
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
  const [selectedLock, setSelectedLock] = useState(0);
  const b = game.board ?? [];

  return (
    <View style={s.stageCard}>
      <View style={s.vaultGrid}>
        {Array.from({ length: 4 }, (_, idx) => {
          const lockVal = b[idx] ?? 0;
          const hint = b[4 + idx] ?? 0;
          const lastGuess = b[8 + idx] ?? 0;
          const cracked = lockVal > 0;
          const digit =
            lockVal > 20 ? lockVal - 20 : lockVal > 10 ? lockVal - 10 : 0;
          const isSelected = !cracked && selectedLock === idx;

          return (
            <Pressable
              key={idx}
              disabled={cracked}
              onPress={() => setSelectedLock(idx)}
              style={[
                s.vaultCard,
                isSelected && s.vaultCardSelected,
                cracked && s.vaultCardCracked,
              ]}
            >
              <Text style={s.vaultIcon}>{cracked ? '🔓' : '🔒'}</Text>
              <Text style={s.vaultTitle}>Khóa #{idx + 1}</Text>
              <Text style={s.vaultCode}>
                {cracked
                  ? `Mã: ${digit}`
                  : lastGuess > 0
                    ? `Vừa thử: ${lastGuess}`
                    : 'Chưa mở'}
              </Text>
              <Text style={s.vaultHint}>
                {cracked
                  ? 'Đã phá (+30đ)'
                  : hint === 1
                    ? '▲ Lớn hơn'
                    : hint === -1
                      ? '▼ Nhỏ hơn'
                      : 'Thử mã 1–4'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {game.status === 'active' && (
        <View style={s.numpadBox}>
          <Text style={s.numpadHint}>
            {(b[selectedLock] ?? 0) > 0
              ? 'Ổ khóa này đã mở! Hãy chọn ổ khóa 🔒 khác:'
              : `Thử mật mã cho Khóa #${selectedLock + 1} (Đúng +30đ, Sai +5đ):`}
          </Text>
          <View style={s.numpadRow}>
            {[1, 2, 3, 4].map(digit => {
              const disabled = busy || !myTurn || (b[selectedLock] ?? 0) > 0;
              return (
                <Pressable
                  key={digit}
                  disabled={disabled}
                  onPress={() => onCrackDigit(selectedLock, digit)}
                  style={[s.numpadBtn, disabled && s.disabledBtn]}
                >
                  <Text style={s.numpadBtnText}>{digit}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

export function GroupQuizArenaStage({
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
    <View style={s.stageCard}>
      {prevQuiz && (
        <View
          style={[
            s.quizFeedback,
            lastResult === 1 ? s.quizFeedbackCorrect : s.quizFeedbackWrong,
          ]}
        >
          <Text style={s.quizFeedbackText}>
            {lastResult === 1
              ? `✅ Chính xác (+20đ)! Đáp án: ${prevQuiz.options[lastCorrect]}`
              : `❌ Chưa đúng! Đáp án đúng: ${prevQuiz.options[lastCorrect]}`}
          </Text>
        </View>
      )}

      <View style={s.quizQuestionBox}>
        <Text style={s.quizStep}>
          {game.status === 'active'
            ? `CÂU HỎI ${step + 1} / 5`
            : 'HOÀN THÀNH 5 CÂU HỎI'}
        </Text>
        <Text style={s.quizQuestion}>{currentQuiz.question}</Text>
      </View>

      {currentQuiz.options.map((opt, idx) => {
        const disabled = busy || !myTurn || game.status !== 'active';
        return (
          <Pressable
            key={idx}
            disabled={disabled}
            onPress={() => onAnswer(idx)}
            style={[s.quizOptionBtn, disabled && s.disabledBtn]}
          >
            <View style={s.quizOptionLetter}>
              <Text style={s.quizOptionLetterText}>
                {String.fromCharCode(65 + idx)}
              </Text>
            </View>
            <Text style={s.quizOptionText}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function GridBoardStage({
  game,
  myMark,
  myTurn,
  busy,
  selectedFrom,
  validStepTargets,
  othelloValidMap,
  winningCells,
  lastMoveCells,
  onCellPress,
}: {
  game: CaroSession;
  myMark: 'X' | 'O';
  myTurn: boolean;
  busy: boolean;
  selectedFrom: number | null;
  validStepTargets: Set<number>;
  othelloValidMap: Map<number, number[]>;
  winningCells: Set<number>;
  lastMoveCells: Set<number>;
  onCellPress: (cell: number) => void;
}) {
  const { width } = useWindowDimensions();
  const info = GAME_INFO[game.gameType];
  if (!info) return null;

  const maxBoardWidth = Math.min(width - 44, 380);
  const gap = info.columns >= 9 ? 1 : info.columns >= 6 ? 2 : 4;
  const cellSize = Math.floor(
    (maxBoardWidth - 12 - gap * (info.columns - 1)) / info.columns,
  );
  const cellHeight =
    game.gameType === 'group_truth_dare' || game.gameType === 'memory_match'
      ? Math.max(cellSize, 66)
      : cellSize;

  const isConnectFour = game.gameType === 'connect_four';
  const isOthello = game.gameType === 'othello';
  const isChessLike = game.gameType === 'chess' || game.gameType === 'checkers';

  return (
    <View style={s.boardOuter}>
      <View
        style={[
          s.boardFrame,
          isConnectFour && s.boardFrameDark,
          isOthello && s.boardFrameGreen,
        ]}
      >
        {Array.from({ length: info.rows }, (_, r) => (
          <React.Fragment key={r}>
            {game.gameType === 'xiangqi' && r === 5 && (
              <View style={s.xiangqiRiver}>
                <Text style={s.xiangqiRiverText}>楚 河 · SỞ HÀ</Text>
                <Text style={s.xiangqiRiverText}>HÁN GIỚI · 漢 界</Text>
              </View>
            )}
            <View
              style={[
                s.boardRow,
                {
                  gap,
                  marginTop: r === 0 ? 0 : gap,
                },
              ]}
            >
              {Array.from({ length: info.columns }, (_, c) => {
                const cell = r * info.columns + c;
                const value = game.board[cell] ?? 0;
                const isDark = (r + c) % 2 === 1;
                const isWinning = winningCells.has(cell);
                const isLastMove = lastMoveCells.has(cell);
                const isSelected = selectedFrom === cell;
                const isValidTarget = validStepTargets.has(cell);
                const ownPiece = isOwnCell(game.gameType, value, myMark);
                const isOthelloValid = othelloValidMap.has(cell);

                const canClick =
                  !busy &&
                  myTurn &&
                  (info.stepMove
                    ? ownPiece || isValidTarget
                    : isConnectFour
                      ? !game.board[c]
                      : isOthello
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

                let bg = '#fbf4e8';
                if (isChessLike) bg = isDark ? '#b58863' : '#f0d9b5';
                else if (isOthello) bg = '#247d4f';
                else if (isConnectFour) bg = '#153a5b';
                else if (game.gameType === 'sudoku_duel') {
                  bg =
                    (r < 2 && c < 2) || (r >= 2 && c >= 2)
                      ? '#f5eadb'
                      : '#fffdf9';
                } else if (game.gameType === 'xiangqi') {
                  bg = '#ebd2ab';
                }

                if (isLastMove) bg = '#fde7b2';
                if (isWinning) bg = '#ffd666';
                if (isSelected) bg = '#f7c59f';

                return (
                  <Pressable
                    key={cell}
                    disabled={!canClick}
                    onPress={() => onCellPress(cell)}
                    style={{
                      width: cellSize,
                      height: cellHeight,
                      backgroundColor: bg,
                      borderRadius:
                        info.columns <= 6 ? 8 : info.columns <= 8 ? 4 : 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: isSelected || isValidTarget ? 2 : 0.5,
                      borderColor: isSelected
                        ? '#b75020'
                        : isValidTarget
                          ? value
                            ? '#dc2626'
                            : '#16a34a'
                          : isOthello
                            ? '#185c38'
                            : '#cdb497',
                    }}
                  >
                    {renderCellVisual(
                      game.gameType,
                      value,
                      cellSize,
                      isOthelloValid || (isValidTarget && !value),
                    )}
                  </Pressable>
                );
              })}
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function renderCellVisual(
  gameType: GameType,
  value: number,
  cellSize: number,
  showHintDot: boolean,
) {
  if (gameType === 'group_truth_dare') {
    if (!value) return <Text style={{ fontSize: 22 }}>💌</Text>;
    const isDare = value >= 200;
    return (
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 18 }}>{isDare ? '🔥' : '💬'}</Text>
        <Text
          style={{
            fontSize: 9.5,
            fontWeight: '700',
            color: isDare ? '#b75020' : '#2563eb',
          }}
        >
          {isDare ? 'Thử thách' : 'Sự thật'}
        </Text>
      </View>
    );
  }

  if (gameType === 'group_lucky_wheel') {
    if (!value) return <Text style={{ fontSize: 22 }}>🎁</Text>;
    const map: Record<number, [string, string]> = {
      50: ['👑', '+50đ'],
      30: ['💎', '+30đ'],
      15: ['🧧', '+15đ'],
      10: ['🍀', '+10đ'],
      [-15]: ['🌀', '-15đ'],
    };
    const [icon, pts] = map[value] ?? ['🐸', '0đ'];
    return (
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 18 }}>{icon}</Text>
        <Text style={{ fontSize: 10, fontWeight: '800', color: '#4a3525' }}>
          {pts}
        </Text>
      </View>
    );
  }

  if (gameType === 'group_spy_hunt') {
    if (!value) return <Text style={{ fontSize: 18 }}>🏢</Text>;
    if (value === 30) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 16 }}>🕵️</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: '#0f766e' }}>
            +5đ
          </Text>
        </View>
      );
    }
    if (value === 20) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 16 }}>📂</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: '#b45309' }}>
            +2đ
          </Text>
        </View>
      );
    }
    if (value === -10) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 16 }}>🚨</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: '#dc2626' }}>
            -2đ
          </Text>
        </View>
      );
    }
    const clue = Math.max(0, value - 10);
    return (
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#334155' }}>
        {clue}
      </Text>
    );
  }

  if (gameType === 'memory_match') {
    if (!value) {
      return (
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#b75020' }}>
          ✦
        </Text>
      );
    }
    const iconId = value > 10 ? value - 10 : value;
    const item = MEMORY_ICONS[iconId] ?? { emoji: '⭐', label: 'Thẻ' };
    return (
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: 9.5, fontWeight: '700', color: '#5b4331' }}
        >
          {item.label}
        </Text>
      </View>
    );
  }

  if (gameType === 'treasure_hunt') {
    if (!value) return <Text style={{ fontSize: 15 }}>⛏️</Text>;
    if (value === 30) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 14 }}>💎</Text>
          <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#0f766e' }}>
            +4
          </Text>
        </View>
      );
    }
    if (value === 20) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 14 }}>💰</Text>
          <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#b45309' }}>
            +2
          </Text>
        </View>
      );
    }
    if (value === -10) {
      return (
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 14 }}>💣</Text>
          <Text style={{ fontSize: 8.5, fontWeight: '800', color: '#dc2626' }}>
            -2
          </Text>
        </View>
      );
    }
    const clue = Math.max(0, value - 10);
    return (
      <Text style={{ fontSize: 13, fontWeight: '800', color: '#334155' }}>
        {clue}
      </Text>
    );
  }

  if (gameType === 'sudoku_duel') {
    if (!value) {
      return (
        <Text style={{ fontSize: 20, fontWeight: '800', color: '#a8917d' }}>
          ?
        </Text>
      );
    }
    const num = value > 20 ? value - 20 : value > 10 ? value - 10 : value;
    const color = value > 20 ? '#1d4ed8' : value > 10 ? '#b75020' : '#2c1e15';
    return (
      <Text style={{ fontSize: 22, fontWeight: '800', color }}>{num}</Text>
    );
  }

  if (!value) {
    if (showHintDot) {
      return (
        <View
          style={{
            width: Math.max(8, cellSize * 0.28),
            height: Math.max(8, cellSize * 0.28),
            borderRadius: 99,
            backgroundColor: 'rgba(22, 163, 74, 0.55)',
          }}
        />
      );
    }
    if (gameType === 'connect_four') {
      return (
        <View
          style={{
            width: cellSize * 0.72,
            height: cellSize * 0.72,
            borderRadius: 99,
            backgroundColor: '#faf6ef',
          }}
        />
      );
    }
    return null;
  }

  if (gameType === 'connect_four') {
    return (
      <View
        style={{
          width: cellSize * 0.76,
          height: cellSize * 0.76,
          borderRadius: 99,
          backgroundColor: value === 1 ? '#facc15' : '#ef4444',
          borderWidth: 2,
          borderColor: value === 1 ? '#ca8a04' : '#b91c1c',
        }}
      />
    );
  }

  if (gameType === 'othello') {
    return (
      <View
        style={{
          width: cellSize * 0.76,
          height: cellSize * 0.76,
          borderRadius: 99,
          backgroundColor: value === 1 ? '#1e1b18' : '#fffdf9',
          borderWidth: 1.5,
          borderColor: value === 1 ? '#000000' : '#d6ccc2',
        }}
      />
    );
  }

  if (gameType === 'xiangqi') {
    const piece = XIANGQI_PIECES[value];
    if (!piece) return null;
    const isRed = value > 0;
    const disc = Math.max(24, cellSize - 4);
    return (
      <View
        style={{
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          backgroundColor: '#fff6e5',
          borderWidth: 1.5,
          borderColor: isRed ? '#c82333' : '#222222',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: Math.max(11, Math.floor(disc * 0.54)),
            fontWeight: '800',
            color: isRed ? '#c82333' : '#1f1f1f',
          }}
        >
          {piece.hanzi}
        </Text>
      </View>
    );
  }

  if (gameType === 'chess') {
    const piece = CHESS_PIECES[value];
    if (!piece) return null;
    return (
      <Text
        style={{
          fontSize: Math.max(18, Math.floor(cellSize * 0.68)),
          color: value > 0 ? '#ffffff' : '#1a1512',
          textShadowColor:
            value > 0 ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.45)',
          textShadowOffset: { width: 0, height: 1 },
          textShadowRadius: 1,
        }}
      >
        {piece.glyph}
      </Text>
    );
  }

  if (gameType === 'checkers') {
    const isRed = value > 0;
    const isKing = Math.abs(value) === 2;
    const disc = cellSize * 0.74;
    return (
      <View
        style={{
          width: disc,
          height: disc,
          borderRadius: 99,
          backgroundColor: isRed ? '#dc2626' : '#1f2937',
          borderWidth: 2,
          borderColor: isKing ? '#facc15' : isRed ? '#991b1b' : '#111827',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isKing && <Text style={{ fontSize: 12 }}>👑</Text>}
      </View>
    );
  }

  if (gameType === 'co_ganh') {
    const disc = cellSize * 0.66;
    return (
      <View
        style={{
          width: disc,
          height: disc,
          borderRadius: 99,
          backgroundColor: value === 1 ? '#dc2626' : '#2563eb',
          borderWidth: 2,
          borderColor: value === 1 ? '#991b1b' : '#1d4ed8',
        }}
      />
    );
  }

  // Caro & Tic-Tac-Toe
  const fontSize =
    gameType === 'caro'
      ? Math.max(10, Math.floor(cellSize * 0.65))
      : Math.max(24, Math.floor(cellSize * 0.56));
  return (
    <Text
      style={{
        fontSize,
        fontWeight: '900',
        color: value === 1 ? '#c83e2b' : '#1d6fa5',
      }}
    >
      {value === 1 ? 'X' : value === 2 ? 'O' : ''}
    </Text>
  );
}
