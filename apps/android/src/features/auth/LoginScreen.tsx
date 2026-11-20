import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { SocialBrandIcon, UiGlyph } from '../../components/Icons';
import { styles } from '../../styles';

export function Login({ onLogin }: { onLogin: (user: api.User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailError, setEmailError] = useState('');
  const passwordInput = useRef<React.ElementRef<typeof TextInput>>(null);
  const formScroll = useRef<React.ElementRef<typeof ScrollView>>(null);

  const revealFocusedInput = React.useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    if (input) {
      formScroll.current?.scrollResponderScrollNativeHandleToKeyboard(
        input,
        16,
        true,
      );
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = Keyboard.addListener(
      'keyboardDidShow',
      revealFocusedInput,
    );
    return () => subscription.remove();
  }, [revealFocusedInput]);

  function revealInputOnFocus() {
    if (Platform.OS === 'android' && Keyboard.isVisible()) revealFocusedInput();
  }

  function validatedEmail() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setEmailError('Vui lòng nhập email.');
      return undefined;
    }
    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      setEmailError('Email chưa đúng định dạng, ví dụ ban@example.com.');
      return undefined;
    }
    return normalizedEmail;
  }

  function reset(nextMode: 'login' | 'register') {
    setMode(nextMode);
    setStep(1);
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setCode('');
    setChallengeId('');
    setVerificationToken('');
    setError('');
    setNotice('');
    setEmailError('');
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (next) {
      setError(api.errorMessage(next));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (mode === 'login') {
      const normalizedEmail = validatedEmail();
      if (!normalizedEmail || !password) return;
      void run(async () => {
        onLogin((await api.login(normalizedEmail, password)).user);
      });
      return;
    }
    if (step === 1) {
      const normalizedEmail = validatedEmail();
      if (!normalizedEmail) return;
      void run(async () => {
        const result = await api.requestRegistrationCode(normalizedEmail);
        setChallengeId(result.challengeId);
        setStep(2);
        setNotice('Mã xác minh gồm 6 chữ số đã được gửi đến email của bạn.');
      });
      return;
    }
    if (step === 2) {
      if (!/^\d{6}$/.test(code)) {
        setError('Vui lòng nhập đủ 6 chữ số trong email xác minh.');
        return;
      }
      void run(async () => {
        const result = await api.verifyRegistrationCode(challengeId, code);
        setVerificationToken(result.verificationToken);
        setStep(3);
        setNotice('Email đã xác minh. Hãy hoàn tất tài khoản.');
      });
      return;
    }
    if (!displayName.trim() || displayName.trim().length > 100) {
      setError('Tên hiển thị cần từ 1 đến 100 ký tự.');
      return;
    }
    if (password.length < 6 || password.length > 128) {
      setError('Mật khẩu cần từ 6 đến 128 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Hai mật khẩu chưa khớp nhau.');
      return;
    }
    void run(async () => {
      await api.register({
        email: email.trim(),
        password,
        confirmPassword,
        displayName: displayName.trim(),
        verificationToken,
      });
      reset('login');
      setNotice('Tạo tài khoản thành công. Hãy đăng nhập để tiếp tục.');
    });
  }

  const buttonDisabled =
    busy ||
    (mode === 'login' && (!email.trim() || !password)) ||
    (mode === 'register' && step === 1 && !email.trim()) ||
    (mode === 'register' && step === 2 && code.length !== 6) ||
    (mode === 'register' &&
      step === 3 &&
      (!displayName.trim() || !password || !confirmPassword));

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.loginPage}
    >
      <ScrollView
        ref={formScroll}
        bounces={false}
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.loginBlushGlow} pointerEvents="none" />
        <View style={styles.loginBrandRow}>
          <SocialBrandIcon />
          <Text style={styles.loginBrandText}>
            Ping<Text style={styles.loginBrandCoral}>Pong</Text>
          </Text>
        </View>
        <View style={styles.loginCard}>
          <View style={styles.loginTopEyebrowWrap}>
            <Text style={styles.loginTopEyebrow}>
              TRÒ CHUYỆN THẬT · GẦN NHAU HƠN
            </Text>
            <View style={styles.loginTopEyebrowBar} />
          </View>
          <View style={styles.loginHeadingRow}>
            {mode === 'login' ? (
              <Text style={styles.loginHeading}>
                Một lời chào.{'\n'}
                <Text style={styles.loginHeadingCoral}>Ngàn kết nối.</Text>
              </Text>
            ) : (
              <Text style={styles.loginHeading}>
                {step === 1
                  ? 'Tạo tài khoản mới'
                  : step === 2
                    ? 'Xác minh email'
                    : 'Hoàn tất tài khoản'}
              </Text>
            )}
            <Text style={styles.loginCaption}>
              {mode === 'login'
                ? 'Chia sẻ khoảnh khắc, giữ gần những người bạn yêu quý.'
                : step === 1
                  ? 'Nhập email để nhận mã xác minh.'
                  : step === 2
                    ? `Xác minh địa chỉ email ${email.trim()}.`
                    : 'Tạo mật khẩu và hoàn tất tài khoản của bạn.'}
            </Text>
          </View>
          {mode === 'register' && (
            <View style={styles.registrationSteps}>
              {['Email', 'Xác minh', 'Tài khoản'].map((label, index) => (
                <View
                  key={label}
                  style={[
                    styles.authRegistrationStep,
                    step >= index + 1 && styles.authRegistrationStepActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.authRegistrationStepText,
                      step >= index + 1 &&
                        styles.authRegistrationStepTextActive,
                    ]}
                  >
                    {index + 1}. {label}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {!!notice && (
            <View style={styles.authSuccessNotice}>
              <Text style={styles.authSuccessNoticeText}>{notice}</Text>
            </View>
          )}
          {!!error && (
            <View style={styles.authErrorNotice}>
              <Text style={styles.authErrorNoticeText}>{error}</Text>
            </View>
          )}
          {(mode === 'login' || step === 1) && (
            <>
              <Text style={styles.authFieldLabel}>Email</Text>
              <View style={styles.authInputWrap}>
                <View style={styles.authInputIcon} pointerEvents="none">
                  <UiGlyph name="mail" color="#976e8b" size={18} />
                </View>
                <TextInput
                  accessibilityLabel="Email"
                  accessibilityState={{ disabled: busy }}
                  autoCapitalize="none"
                  autoComplete="email"
                  blurOnSubmit={false}
                  editable={!busy}
                  keyboardType="email-address"
                  maxLength={254}
                  onFocus={revealInputOnFocus}
                  onChangeText={value => {
                    setEmail(value);
                    setEmailError('');
                    setError('');
                  }}
                  onSubmitEditing={() => {
                    if (mode === 'login') passwordInput.current?.focus();
                    else submit();
                  }}
                  placeholder="yourname@email.com"
                  placeholderTextColor="#aa8fa6"
                  returnKeyType={mode === 'login' ? 'next' : 'done'}
                  style={[
                    styles.authInput,
                    styles.authInputWithIcon,
                    !!emailError && styles.authInputInvalid,
                  ]}
                  value={email}
                />
              </View>
              {!!emailError && (
                <Text style={styles.authFieldError}>{emailError}</Text>
              )}
            </>
          )}
          {mode === 'register' && step === 2 && (
            <>
              <Text style={styles.authFieldLabel}>Mã xác minh</Text>
              <TextInput
                accessibilityLabel="Mã xác minh"
                autoComplete="one-time-code"
                editable={!busy}
                keyboardType="number-pad"
                maxLength={6}
                onFocus={revealInputOnFocus}
                onChangeText={value => {
                  setCode(value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                onSubmitEditing={submit}
                placeholder="000000"
                placeholderTextColor="#aa8fa6"
                returnKeyType="done"
                style={[styles.authInput, styles.codeInput]}
                value={code}
              />
              <Pressable
                disabled={busy}
                onPress={() => {
                  const normalizedEmail = validatedEmail();
                  if (!normalizedEmail) return;
                  void run(async () => {
                    const result =
                      await api.requestRegistrationCode(normalizedEmail);
                    setChallengeId(result.challengeId);
                    setCode('');
                    setNotice('Đã gửi một mã xác minh mới.');
                  });
                }}
                style={styles.authLinkButton}
              >
                <Text style={styles.authLinkButtonText}>Gửi lại mã</Text>
              </Pressable>
            </>
          )}
          {mode === 'register' && step === 3 && (
            <>
              <Text style={styles.authFieldLabel}>Tên hiển thị</Text>
              <TextInput
                accessibilityLabel="Tên hiển thị"
                autoComplete="name"
                editable={!busy}
                maxLength={100}
                onFocus={revealInputOnFocus}
                onChangeText={setDisplayName}
                placeholder="Bạn muốn được gọi là gì?"
                placeholderTextColor="#aa8fa6"
                returnKeyType="next"
                style={styles.authInput}
                value={displayName}
              />
            </>
          )}
          {(mode === 'login' || step === 3) && (
            <>
              <Text style={styles.authFieldLabel}>Mật khẩu</Text>
              <View style={styles.authInputWrap}>
                <View style={styles.authInputIcon} pointerEvents="none">
                  <UiGlyph name="lock" color="#976e8b" size={18} />
                </View>
                <TextInput
                  ref={passwordInput}
                  accessibilityLabel="Mật khẩu"
                  accessibilityState={{ disabled: busy }}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  editable={!busy}
                  maxLength={128}
                  onFocus={revealInputOnFocus}
                  onChangeText={value => {
                    setPassword(value);
                    setError('');
                  }}
                  onSubmitEditing={() => {
                    if (mode === 'login') submit();
                  }}
                  placeholder={
                    mode === 'login'
                      ? 'Nhập mật khẩu của bạn'
                      : 'Tạo mật khẩu từ 6 ký tự'
                  }
                  placeholderTextColor="#aa8fa6"
                  returnKeyType={mode === 'login' ? 'done' : 'next'}
                  secureTextEntry={!passwordVisible}
                  style={[styles.authInput, styles.authPasswordInput]}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={
                    passwordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: passwordVisible }}
                  hitSlop={6}
                  onPress={() => setPasswordVisible(value => !value)}
                  style={styles.authPasswordToggle}
                >
                  <Text style={styles.authPasswordToggleText}>
                    {passwordVisible ? 'Ẩn' : 'Hiện'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
          {mode === 'register' && step === 3 && (
            <>
              <Text style={styles.authFieldLabel}>Xác nhận mật khẩu</Text>
              <TextInput
                accessibilityLabel="Xác nhận mật khẩu"
                autoComplete="new-password"
                editable={!busy}
                maxLength={128}
                onChangeText={setConfirmPassword}
                onFocus={revealInputOnFocus}
                onSubmitEditing={submit}
                placeholder="Nhập lại mật khẩu"
                placeholderTextColor="#aa8fa6"
                returnKeyType="done"
                secureTextEntry={!passwordVisible}
                style={styles.authInput}
                value={confirmPassword}
              />
            </>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={buttonDisabled}
            onPress={submit}
            style={({ pressed }) => [
              styles.authPrimaryButton,
              pressed && styles.pressed,
              buttonDisabled && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#48132f" />
            ) : (
              <View style={styles.authPrimaryButtonContent}>
                <Text style={styles.authPrimaryButtonText}>
                  {mode === 'login'
                    ? 'Đăng nhập'
                    : step === 1
                      ? 'Gửi mã xác minh'
                      : step === 2
                        ? 'Xác minh email'
                        : 'Tạo tài khoản'}
                </Text>
                <Text style={styles.authPrimaryButtonArrow}>→</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.authSwitch}>
            <Text style={styles.authSwitchText}>
              {mode === 'login' ? 'Chưa có tài khoản?' : 'Bạn đã có tài khoản?'}
            </Text>
            <Pressable
              disabled={busy}
              onPress={() => reset(mode === 'login' ? 'register' : 'login')}
            >
              <Text style={styles.authSwitchAction}>
                {mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.securityRow}>
            <Text style={styles.securityIcon}>◆</Text>
            <Text style={styles.securityNote}>
              Phiên đăng nhập được lưu an toàn trên thiết bị
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
