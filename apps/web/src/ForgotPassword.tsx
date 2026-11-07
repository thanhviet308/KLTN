import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
} from 'lucide-react';
import * as api from './api';

export function ForgotPassword({
  initialEmail,
  onBack,
  onComplete,
}: {
  initialEmail: string;
  onBack: () => void;
  onComplete: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const heading = useRef<HTMLHeadingElement>(null);
  const locked = useRef(false);
  useEffect(() => {
    heading.current?.focus();
  }, [challenge]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const fieldError = (field: string) =>
    errors[field] ? (
      <small className="field-error" id={`reset-${field}-error`} role="alert">
        {errors[field]}
      </small>
    ) : null;
  function clear(field: string) {
    setErrors((previous) => ({ ...previous, [field]: '' }));
  }
  async function sendCode() {
    const result = await api.requestPasswordReset(email.trim());
    setChallenge(result.challengeId);
    setCode('');
    setResendAt(Date.now() + result.resendAfterSeconds * 1000);
    setNow(Date.now());
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = event.currentTarget;
    const next: Record<string, string> = {};
    if (!challenge) {
      const input = form.elements.namedItem('email') as HTMLInputElement;
      if (
        !email.trim() ||
        input.validity.typeMismatch ||
        email.trim().length > 254
      )
        next.email = 'Vui lòng nhập địa chỉ email hợp lệ.';
    } else {
      if (!/^\d{6}$/.test(code)) next.code = 'Nhập đủ 6 chữ số trong email.';
      if (password.length < 8 || password.length > 128)
        next.password = 'Mật khẩu cần từ 8 đến 128 ký tự.';
      if (!confirm || confirm !== password)
        next.confirm = 'Hai mật khẩu chưa khớp nhau.';
    }
    setErrors(next);
    setError('');
    if (Object.keys(next).length) {
      (
        form.elements.namedItem(Object.keys(next)[0]) as HTMLInputElement
      )?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      if (!challenge) await sendCode();
      else {
        await api.resetPassword({
          challengeId: challenge,
          code,
          newPassword: password,
          confirmPassword: confirm,
        });
        setPassword('');
        setConfirm('');
        onComplete(email.trim());
      }
    } catch (failure) {
      setError(api.errorMessage(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function resend() {
    if (locked.current || Date.now() < resendAt) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await sendCode();
    } catch (failure) {
      setError(api.errorMessage(failure));
      setResendAt(Date.now() + 60000);
      setNow(Date.now());
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="password-recovery" aria-busy={busy}>
      <h2 ref={heading} tabIndex={-1}>
        {challenge ? 'Đặt mật khẩu mới' : 'Quên mật khẩu?'}
      </h2>
      <p className="intro">
        {challenge
          ? `Nếu ${email.trim()} có tài khoản đang hoạt động, mã sẽ được gửi tới hộp thư này. Kiểm tra cả thư rác; mã có hiệu lực trong 10 phút.`
          : 'Nhập email đã đăng ký để nhận mã đặt lại mật khẩu.'}
      </p>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <form noValidate onSubmit={submit}>
        <fieldset disabled={busy}>
          {!challenge ? (
            <label htmlFor="reset-email">
              Email
              <span className="auth-input-wrap">
                <Mail size={20} aria-hidden="true" />
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clear('email');
                  }}
                  aria-invalid={!!errors.email}
                  aria-describedby={
                    errors.email ? 'reset-email-error' : undefined
                  }
                  placeholder="ban@example.com"
                />
              </span>
              {fieldError('email')}
            </label>
          ) : (
            <>
              <label htmlFor="reset-code">
                Mã xác minh
                <input
                  id="reset-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  placeholder="Nhập mã 6 chữ số"
                  aria-invalid={!!errors.code}
                  aria-describedby={
                    errors.code ? 'reset-code-error' : undefined
                  }
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    clear('code');
                  }}
                />
                {fieldError('code')}
              </label>
              <label htmlFor="reset-password">Mật khẩu mới</label>
              <div className="password">
                <LockKeyhole size={20} aria-hidden="true" />
                <input
                  id="reset-password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  placeholder="Từ 8 đến 128 ký tự"
                  aria-invalid={!!errors.password}
                  aria-describedby={
                    errors.password ? 'reset-password-error' : undefined
                  }
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clear('password');
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
              <label htmlFor="reset-confirm">
                Xác nhận mật khẩu mới
                <input
                  id="reset-confirm"
                  name="confirm"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirm}
                  placeholder="Nhập lại mật khẩu mới"
                  aria-invalid={!!errors.confirm}
                  aria-describedby={
                    errors.confirm ? 'reset-confirm-error' : undefined
                  }
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    clear('confirm');
                  }}
                />
                {fieldError('confirm')}
              </label>
              <small className="hint">
                Đặt lại mật khẩu sẽ đăng xuất tài khoản trên các thiết bị đang
                sử dụng.
              </small>
            </>
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy
              ? 'Đang xử lý…'
              : challenge
                ? 'Đặt lại mật khẩu'
                : 'Gửi mã xác minh'}
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          {challenge && (
            <>
              <button
                className="retry recovery-link"
                type="button"
                disabled={busy || now < resendAt}
                onClick={() => void resend()}
              >
                {now < resendAt
                  ? `Gửi lại mã sau ${Math.ceil((resendAt - now) / 1000)} giây`
                  : 'Gửi lại mã'}
              </button>
              <button
                className="retry recovery-link"
                type="button"
                disabled={busy}
                onClick={() => {
                  setChallenge('');
                  setCode('');
                  setPassword('');
                  setConfirm('');
                  setVisible(false);
                  setErrors({});
                  setError('');
                }}
              >
                Dùng email khác
              </button>
            </>
          )}
        </fieldset>
      </form>
      <p className="switch">
        <button type="button" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Quay lại đăng nhập
        </button>
      </p>
    </div>
  );
}
