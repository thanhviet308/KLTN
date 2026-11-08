import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  MessagesSquare,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import * as api from '../../lib/api';
import { ForgotPassword } from './ForgotPassword';

interface AuthPageProps {
  booting: boolean;
  initialError?: string;
  initialNotice?: string;
  onAuthenticated: (user: api.User) => void;
}

export function AuthPage({
  booting,
  initialError = '',
  initialNotice = '',
  onAuthenticated,
}: AuthPageProps) {
  const reducedMotion = useReducedMotion();
  const [avatarPreview, setAvatarPreview] = useState('nova');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [forgotPassword, setForgotPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState(initialNotice);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  function fieldError(field: string) {
    return fieldErrors[field] ? (
      <small id={`${field}-error`} className="field-error" role="alert">
        {fieldErrors[field]}
      </small>
    ) : null;
  }
  function clearFieldError(field: string) {
    setFieldErrors((previous) => ({ ...previous, [field]: '' }));
  }
  const [sendingCode, setSendingCode] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (mode === 'register') heading.current?.focus();
  }, [step, mode]);

  useEffect(() => {
    if (mode !== 'register' || step !== 2) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, step]);

  function resetRegistration() {
    setFieldErrors({});
    setStep(1);
    setCode('');
    setCodeError('');
    setChallengeId('');
    setVerificationToken('');
    setPassword('');
    setConfirmPassword('');
    setVisible(false);
  }

  async function sendCode() {
    setCodeError('');
    setSendingCode(true);
    setChallengeId('');
    setCode('');
    try {
      const result = await api.requestRegistrationCode(email.trim());
      setChallengeId(result.challengeId);
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      setNow(Date.now());
      setStep(2);
    } catch (e) {
      // Delivery failures can still consume the server's resend cooldown.
      if (
        !(e instanceof api.ApiError) ||
        e.code !== 'EMAIL_ALREADY_REGISTERED'
      ) {
        setResendAt(Date.now() + 60000);
        setNow(Date.now());
      }
      throw e;
    } finally {
      setSendingCode(false);
    }
  }

  async function resendCode() {
    if (busy || Date.now() < resendAt) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await sendCode();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    resetRegistration();
    setPassword('');
    setVisible(false);
    setError('');
    setNotice('');
    setTimeout(() => heading.current?.focus(), 0);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    if (mode === 'register' && step === 2 && !/^[0-9]{6}$/.test(code)) {
      setCodeError('Vui lòng nhập đủ 6 chữ số trong email xác minh.');
      return;
    }
    const errors: Record<string, string> = {};
    if (mode === 'login' || step === 1) {
      const emailInput = event.currentTarget.elements.namedItem(
        'email',
      ) as HTMLInputElement;
      if (!email.trim()) errors.email = 'Vui lòng nhập email.';
      else if (emailInput.validity.typeMismatch || email.trim().length > 254)
        errors.email =
          'Vui lòng nhập địa chỉ email hợp lệ, ví dụ: ban@example.com.';
    }
    if (mode === 'login' || step === 3) {
      if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
      else if (
        password.length > 128 ||
        (mode === 'register' && password.length < 6)
      )
        errors.password = 'Mật khẩu cần từ 6 đến 128 ký tự.';
      if (mode === 'register') {
        if (!name.trim()) errors.displayName = 'Vui lòng nhập tên hiển thị.';
        else if (name.trim().length > 100)
          errors.displayName = 'Tên hiển thị tối đa 100 ký tự.';
        if (!confirmPassword)
          errors.confirmPassword = 'Vui lòng nhập lại mật khẩu.';
        else if (password !== confirmPassword)
          errors.confirmPassword = 'Hai mật khẩu chưa khớp nhau.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      (
        event.currentTarget.elements.namedItem(
          Object.keys(errors)[0],
        ) as HTMLInputElement
      )?.focus();
      return;
    }
    if (mode === 'register' && step === 3 && !name.trim()) {
      setError('Vui lòng nhập tên hiển thị.');
      return;
    }
    if (mode === 'register' && step === 3 && password !== confirmPassword) {
      setError('Hai mật khẩu chưa khớp nhau.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'register') {
        if (step === 1) {
          await sendCode();
          return;
        }
        if (step === 2) {
          if (!challengeId || sendingCode) return;
          const result = await api.verifyRegistrationCode(challengeId, code);
          setVerificationToken(result.verificationToken);
          setStep(3);
          setNotice('Email đã xác minh. Hãy hoàn tất thông tin tài khoản.');
          return;
        }
        await api.register({
          email: email.trim(),
          password,
          displayName: name.trim(),
          confirmPassword,
          verificationToken,
        });
        resetRegistration();
        setMode('login');
        setNotice('Tạo tài khoản thành công. Hãy đăng nhập để tiếp tục.');
      } else {
        const session = await api.login(email.trim(), password);
        onAuthenticated(session.user);
      }
      setPassword('');
      setVisible(false);
      heading.current?.focus();
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'EMAIL_ALREADY_REGISTERED') {
        setStep(1);
        setFieldErrors({ email: api.errorMessage(e) });
        setError('');
        setTimeout(
          () =>
            document
              .querySelector<HTMLInputElement>('input[name="email"]')
              ?.focus(),
          0,
        );
      } else if (
        e instanceof api.ApiError &&
        e.code === 'INVALID_VERIFICATION_CODE'
      ) {
        setCodeError(
          'Mã xác minh chưa đúng hoặc đã hết hạn. Kiểm tra email hoặc gửi lại mã.',
        );
      } else setError(api.errorMessage(e));
      if (e instanceof api.ApiError && e.code === 'EMAIL_VERIFICATION_REQUIRED')
        resetRegistration();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`page ${mode === 'login' ? 'auth-login' : 'auth-register'}`}
    >
      <a className="brand" href="/" aria-label="PingPong — trang chủ">
        <span className="social-brand-icon" aria-hidden="true">
          <i>•••</i>
          <i>•••</i>
        </span>
        <span>
          Ping<span className="brand-coral">Pong</span>
        </span>
      </a>
      <aside className="story">
        <div className="story-content">
          <h1>
            Kết nối
            <br />
            <span className="story-accent">không giới hạn.</span>
          </h1>
          <p>
            Bắt đầu cuộc trò chuyện
            <br />
            theo cách của bạn.
          </p>
          <div className="auth-art-stage" aria-hidden="true">
            <span className="auth-art-orbit" />
            <span className="auth-illustration-frame">
              <motion.img
                className="auth-illustration"
                src="/images/plum-coral-social.png"
                alt=""
                initial={
                  reducedMotion ? false : { opacity: 0, y: 24, scale: 0.96 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
              />
            </span>
            <span className="auth-art-caption">Gần nhau hơn, mỗi ngày.</span>
          </div>
        </div>
        <div className="story-footer" />
      </aside>
      <main>
        <div className="main-top">
          <span>TRÒ CHUYỆN THẬT · GẦN NHAU HƠN</span>
        </div>
        <motion.section
          className="card"
          aria-busy={busy || booting}
          initial={reducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.12 }}
        >
          {booting ? (
            <div className="loading" role="status">
              <span className="spinner" />
              Đang khôi phục phiên đăng nhập…
            </div>
          ) : forgotPassword ? (
            <ForgotPassword
              initialEmail={email}
              onBack={() => {
                setForgotPassword(false);
                setTimeout(() => heading.current?.focus(), 0);
              }}
              onComplete={(recoveredEmail) => {
                setEmail(recoveredEmail);
                setPassword('');
                setVisible(false);
                setForgotPassword(false);
                setMode('login');
                setError('');
                setNotice(
                  'Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.',
                );
                setTimeout(() => heading.current?.focus(), 0);
              }}
            />
          ) : (
            <>
              <div className="cyber-card-brand" aria-hidden="true">
                <MessagesSquare />
                <span>PingPong</span>
              </div>
              <h2 ref={heading} tabIndex={-1}>
                {mode === 'login' ? (
                  <>
                    Một lời chào.
                    <br />
                    <span className="title-coral">Ngàn kết nối.</span>
                  </>
                ) : (
                  'Tạo tài khoản mới'
                )}
              </h2>
              <p className="intro">
                {mode === 'login'
                  ? 'Chia sẻ khoảnh khắc, giữ gần những người bạn yêu quý.'
                  : step === 1
                    ? 'Nhập email để nhận mã xác minh.'
                    : step === 2
                      ? `Xác minh địa chỉ email ${email}.`
                      : 'Tạo mật khẩu và hoàn tất tài khoản của bạn.'}
              </p>
              {mode === 'register' && (
                <ol
                  className="registration-steps"
                  aria-label="Tiến trình đăng ký"
                >
                  {['Email', 'Xác minh', 'Tài khoản'].map((label, index) => (
                    <li
                      key={label}
                      aria-current={step === index + 1 ? 'step' : undefined}
                      className={step >= index + 1 ? 'active' : ''}
                    >
                      {index + 1}. {label}
                    </li>
                  ))}
                </ol>
              )}
              {notice && (
                <div className="message success" role="status">
                  {notice}
                </div>
              )}
              {error && (
                <div className="message error" role="alert">
                  {error}
                </div>
              )}
              <form noValidate onSubmit={submit}>
                <fieldset disabled={busy && !sendingCode}>
                  {mode === 'register' && step === 3 && (
                    <label>
                      Tên hiển thị
                      <input
                        name="displayName"
                        aria-invalid={!!fieldErrors.displayName}
                        aria-describedby={
                          fieldErrors.displayName
                            ? 'displayName-error'
                            : undefined
                        }
                        autoComplete="nickname"
                        placeholder="Bạn muốn được gọi là gì?"
                        required
                        maxLength={100}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          clearFieldError('displayName');
                        }}
                      />
                      {fieldError('displayName')}
                    </label>
                  )}
                  {(mode === 'login' || step === 1) && (
                    <label>
                      Email
                      <span className="auth-input-wrap">
                        <Mail size={20} aria-hidden="true" />
                        <input
                          type="email"
                          name="email"
                          aria-invalid={!!fieldErrors.email}
                          aria-describedby={
                            fieldErrors.email ? 'email-error' : undefined
                          }
                          autoComplete="username"
                          placeholder="yourname@email.com"
                          required
                          maxLength={254}
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            clearFieldError('email');
                          }}
                        />
                      </span>
                      {fieldError('email')}
                    </label>
                  )}
                  {mode === 'register' && step === 2 && (
                    <label>
                      Mã xác minh
                      <input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        aria-invalid={!!codeError}
                        aria-describedby={codeError ? 'code-error' : undefined}
                        placeholder="000000"
                        value={code}
                        onChange={(e) => {
                          setCode(
                            e.target.value.replace(/\D/g, '').slice(0, 6),
                          );
                          setCodeError('');
                        }}
                      />
                      {codeError && (
                        <small
                          id="code-error"
                          className="field-error"
                          role="alert"
                        >
                          {codeError}
                        </small>
                      )}
                    </label>
                  )}
                  {(mode === 'login' || step === 3) && (
                    <>
                      <label htmlFor="password">Mật khẩu</label>
                      <div className="password">
                        <LockKeyhole size={20} aria-hidden="true" />
                        <input
                          id="password"
                          name="password"
                          aria-invalid={!!fieldErrors.password}
                          type={visible ? 'text' : 'password'}
                          autoComplete={
                            mode === 'login'
                              ? 'current-password'
                              : 'new-password'
                          }
                          placeholder={
                            mode === 'login'
                              ? 'Nhập mật khẩu của bạn'
                              : 'Tạo mật khẩu từ 6 ký tự'
                          }
                          required
                          minLength={mode === 'register' ? 6 : 1}
                          maxLength={128}
                          aria-describedby={
                            [
                              fieldErrors.password ? 'password-error' : '',
                              mode === 'register' ? 'password-hint' : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            clearFieldError('password');
                            clearFieldError('confirmPassword');
                          }}
                        />
                        <button
                          type="button"
                          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          aria-pressed={visible}
                          onClick={() => setVisible(!visible)}
                        >
                          {visible ? (
                            <EyeOff size={20} aria-hidden="true" />
                          ) : (
                            <Eye size={20} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      {fieldError('password')}
                      {mode === 'register' && (
                        <small id="password-hint" className="hint">
                          6–128 ký tự. Một cụm từ dài sẽ dễ nhớ và an toàn hơn.
                        </small>
                      )}
                      {mode === 'register' && (
                        <label>
                          Xác nhận mật khẩu
                          <input
                            name="confirmPassword"
                            aria-invalid={!!fieldErrors.confirmPassword}
                            aria-describedby={
                              fieldErrors.confirmPassword
                                ? 'confirmPassword-error'
                                : undefined
                            }
                            type={visible ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            minLength={6}
                            maxLength={128}
                            placeholder="Nhập lại mật khẩu"
                            value={confirmPassword}
                            onChange={(e) => {
                              setConfirmPassword(e.target.value);
                              clearFieldError('confirmPassword');
                            }}
                          />
                          {fieldError('confirmPassword')}
                        </label>
                      )}
                    </>
                  )}
                  {mode === 'login' && (
                    <button
                      className="forgot-password-link"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        setNotice('');
                        setPassword('');
                        setVisible(false);
                        setForgotPassword(true);
                      }}
                    >
                      Quên mật khẩu?
                    </button>
                  )}
                  {mode === 'login' && (
                    <div
                      className="cyber-avatars"
                      role="group"
                      aria-label="Xem trước phong cách avatar"
                    >
                      <span className="cyber-avatar-label">
                        Khám phá avatar của bạn <small>Chọn để xem trước</small>
                      </span>
                      <div className="cyber-avatar-options">
                        {[
                          ['nova', 'Nova'],
                          ['orbit', 'Orbit'],
                          ['zero', 'Zero'],
                        ].map(([id, name]) => (
                          <button
                            key={id}
                            type="button"
                            aria-label={`Xem avatar ${name}`}
                            aria-pressed={avatarPreview === id}
                            onClick={() => setAvatarPreview(id)}
                          >
                            <img src={`/images/avatar-${id}.png`} alt="" />
                            {avatarPreview === id && (
                              <Check size={13} aria-hidden="true" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    className={`primary${mode === 'register' && step === 2 ? ' verification-primary' : ''}`}
                    type="submit"
                    disabled={
                      busy ||
                      (mode === 'register' && step === 2 && !challengeId)
                    }
                  >
                    {busy && !sendingCode
                      ? 'Đang xử lý…'
                      : mode === 'login'
                        ? 'Đăng nhập'
                        : step === 1
                          ? 'Gửi mã xác minh'
                          : step === 2
                            ? 'Xác minh email'
                            : 'Tạo tài khoản'}
                    <span>
                      {busy && !sendingCode ? (
                        <span className="spinner" />
                      ) : (
                        <ArrowRight size={21} aria-hidden="true" />
                      )}
                    </span>
                  </button>
                  {mode === 'register' && step === 2 && (
                    <button
                      className="retry"
                      type="button"
                      disabled={busy || now < resendAt}
                      onClick={() => void resendCode()}
                    >
                      {now < resendAt
                        ? `Gửi lại mã sau ${Math.ceil((resendAt - now) / 1000)} giây`
                        : 'Gửi lại mã'}
                    </button>
                  )}
                  {mode === 'register' && step > 1 && (
                    <button
                      className="retry"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        resetRegistration();
                        setNotice('');
                        setError('');
                      }}
                    >
                      Dùng email khác / bắt đầu lại
                    </button>
                  )}
                </fieldset>
              </form>
              <p className="switch">
                {mode === 'login'
                  ? 'Chưa có tài khoản?'
                  : 'Bạn đã có tài khoản?'}{' '}
                <button disabled={busy} onClick={switchMode}>
                  {mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}
                </button>
              </p>
            </>
          )}
        </motion.section>
        <footer className="main-footer">
          Một lời chào nhỏ. Một kết nối mới.
        </footer>
      </main>
    </div>
  );
}
