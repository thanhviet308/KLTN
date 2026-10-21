import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as api from '../../api';
import { Brand, InlineNotice } from '../../components/Common';
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
        bounces={false}
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.loginHero}>
          <Brand inverse />
          <Text style={styles.loginEyebrow}>GẦN NHAU HƠN, MỖI NGÀY</Text>
          <Text style={styles.loginHeroTitle}>
            Mọi kết nối tốt đẹp bắt đầu từ một lời chào.
          </Text>
          <Text style={styles.loginHeroCopy}>
            Trò chuyện và giữ liên lạc với những người quan trọng.
          </Text>
        </View>
        <View style={styles.loginCard}>
          <View style={styles.loginHeadingRow}>
            <View>
              <Text style={styles.loginEyebrowDark}>BẮT ĐẦU KẾT NỐI</Text>
              <Text style={styles.loginHeading}>
                {mode === 'login'
                  ? 'Chào mừng trở lại.'
                  : step === 1
                    ? 'Tạo tài khoản.'
                    : step === 2
                      ? 'Xác minh email.'
                      : 'Hoàn tất tài khoản.'}
              </Text>
              <Text style={styles.loginCaption}>
                {mode === 'login'
                  ? 'Đăng nhập để tiếp tục những cuộc trò chuyện.'
                  : step === 1
                    ? 'Dùng email của bạn để bắt đầu.'
                    : step === 2
                      ? `Nhập mã đã gửi đến ${email.trim()}.`
                      : 'Chọn tên hiển thị và mật khẩu.'}
              </Text>
            </View>
          </View>
          {mode === 'register' && (
            <View style={styles.registrationSteps}>
              {['Email', 'Xác minh', 'Tài khoản'].map((label, index) => (
                <View
                  key={label}
                  style={[
                    styles.registrationStep,
                    step >= index + 1 && styles.registrationStepActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.registrationStepText,
                      step >= index + 1 && styles.registrationStepTextActive,
                    ]}
                  >
                    {index + 1}. {label}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {(mode === 'login' || step === 1) && (
            <>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                accessibilityLabel="Email"
                accessibilityState={{ disabled: busy }}
                autoCapitalize="none"
                autoComplete="email"
                blurOnSubmit={false}
                editable={!busy}
                keyboardType="email-address"
                maxLength={254}
                onChangeText={value => {
                  setEmail(value);
                  setEmailError('');
                  setError('');
                }}
                onSubmitEditing={() => {
                  if (mode === 'login') passwordInput.current?.focus();
                  else submit();
                }}
                placeholder="ban@example.com"
                placeholderTextColor="#9aa59e"
                returnKeyType={mode === 'login' ? 'next' : 'done'}
                style={[styles.input, !!emailError && styles.inputInvalid]}
                value={email}
              />
              {!!emailError && (
                <Text style={styles.fieldError}>{emailError}</Text>
              )}
            </>
          )}
          {mode === 'register' && step === 2 && (
            <>
              <Text style={styles.fieldLabel}>Mã xác minh</Text>
              <TextInput
                accessibilityLabel="Mã xác minh"
                autoComplete="one-time-code"
                editable={!busy}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={value => {
                  setCode(value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                onSubmitEditing={submit}
                placeholder="000000"
                placeholderTextColor="#9aa59e"
                returnKeyType="done"
                style={[styles.input, styles.codeInput]}
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
                style={styles.linkButton}
              >
                <Text style={styles.linkButtonText}>Gửi lại mã</Text>
              </Pressable>
            </>
          )}
          {mode === 'register' && step === 3 && (
            <>
              <Text style={styles.fieldLabel}>Tên hiển thị</Text>
              <TextInput
                accessibilityLabel="Tên hiển thị"
                autoComplete="name"
                editable={!busy}
                maxLength={100}
                onChangeText={setDisplayName}
                placeholder="Bạn muốn được gọi là gì?"
                placeholderTextColor="#9aa59e"
                returnKeyType="next"
                style={styles.input}
                value={displayName}
              />
            </>
          )}
          {(mode === 'login' || step === 3) && (
            <>
              <Text style={styles.fieldLabel}>Mật khẩu</Text>
              <View style={styles.passwordField}>
                <TextInput
                  ref={passwordInput}
                  accessibilityLabel="Mật khẩu"
                  accessibilityState={{ disabled: busy }}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  editable={!busy}
                  maxLength={128}
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
                  placeholderTextColor="#9aa59e"
                  returnKeyType={mode === 'login' ? 'done' : 'next'}
                  secureTextEntry={!passwordVisible}
                  style={[styles.input, styles.passwordInput]}
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
                  style={styles.passwordToggle}
                >
                  <Text style={styles.passwordToggleText}>
                    {passwordVisible ? 'Ẩn' : 'Hiện'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
          {mode === 'register' && step === 3 && (
            <>
              <Text style={styles.fieldLabel}>Xác nhận mật khẩu</Text>
              <TextInput
                accessibilityLabel="Xác nhận mật khẩu"
                autoComplete="new-password"
                editable={!busy}
                maxLength={128}
                onChangeText={setConfirmPassword}
                onSubmitEditing={submit}
                placeholder="Nhập lại mật khẩu"
                placeholderTextColor="#9aa59e"
                returnKeyType="done"
                secureTextEntry={!passwordVisible}
                style={styles.input}
                value={confirmPassword}
              />
            </>
          )}
          {!!notice && (
            <View style={styles.successNotice}>
              <Text style={styles.successNoticeText}>{notice}</Text>
            </View>
          )}
          {!!error && (
            <View style={styles.loginNotice}>
              <InlineNotice message={error} />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={buttonDisabled}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              buttonDisabled && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <View style={styles.primaryButtonContent}>
                <Text style={styles.primaryButtonText}>
                  {mode === 'login'
                    ? 'Đăng nhập'
                    : step === 1
                      ? 'Gửi mã xác minh'
                      : step === 2
                        ? 'Xác minh email'
                        : 'Tạo tài khoản'}
                </Text>
                <Text style={styles.primaryButtonArrow}>→</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.authSwitch}>
            <Text style={styles.authSwitchText}>
              {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}
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
