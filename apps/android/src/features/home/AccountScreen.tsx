import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import * as api from '../../api';
import { Avatar, InlineNotice, ScreenIntro } from '../../components/Common';
import { styles } from '../../styles';

export function AccountScreen({
  user,
  onUser,
  onLogout,
  onExpired,
}: {
  user: api.User;
  onUser: (user: api.User) => void;
  onLogout: () => Promise<void>;
  onExpired: () => void;
}) {
  const [section, setSection] = useState<'main' | 'name' | 'password'>('main');
  const [name, setName] = useState(user.displayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(work: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(success);
    } catch (next) {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.accountScreen}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenIntro title="Tài khoản" caption="Thông tin và bảo mật" />
      <View style={styles.accountHero}>
        <Avatar peer={user} size={68} />
        <View style={styles.accountHeroText}>
          <Text style={styles.accountName}>{user.displayName}</Text>
          <Text numberOfLines={1} style={styles.accountEmail}>
            {user.email}
          </Text>
        </View>
      </View>
      {!!notice && (
        <View style={styles.listSuccessNotice}>
          <Text style={styles.successNoticeText}>{notice}</Text>
        </View>
      )}
      {!!error && (
        <View style={styles.listNotice}>
          <InlineNotice message={error} />
        </View>
      )}
      {section === 'main' ? (
        <View style={styles.settingsCard}>
          <Pressable
            disabled={busy}
            onPress={() =>
              void (async () => {
                const result = await launchImageLibrary({
                  mediaType: 'photo',
                  selectionLimit: 1,
                  includeBase64: true,
                  maxWidth: 640,
                  maxHeight: 640,
                  quality: 0.8,
                });
                if (result.didCancel) return;
                if (result.errorCode) {
                  setError(result.errorMessage ?? 'Không thể chọn ảnh.');
                  return;
                }
                const image = result.assets?.[0];
                if (!image?.base64 || !image.type) {
                  setError('Không thể đọc ảnh đã chọn.');
                  return;
                }
                await run(async () => {
                  const updated = await api.authenticated<{
                    user: api.User;
                  }>(
                    '/users/me/avatar',
                    { image: `data:${image.type};base64,${image.base64}` },
                    'PATCH',
                  );
                  onUser(updated.user);
                }, 'Đã cập nhật ảnh đại diện.');
              })().catch(next => setError(api.errorMessage(next)))
            }
            style={styles.settingRow}
          >
            <View style={styles.settingIcon}>
              <Text style={styles.settingIconText}>▧</Text>
            </View>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Ảnh đại diện</Text>
              <Text style={styles.settingCaption}>Chọn ảnh từ thiết bị</Text>
            </View>
            <Text style={styles.settingArrow}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setName(user.displayName);
              setSection('name');
            }}
            style={styles.settingRow}
          >
            <View style={styles.settingIcon}>
              <Text style={styles.settingIconText}>Aa</Text>
            </View>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Tên hiển thị</Text>
              <Text style={styles.settingCaption}>Tên bạn bè nhìn thấy</Text>
            </View>
            <Text style={styles.settingArrow}>›</Text>
          </Pressable>
          <Pressable
            onPress={() => setSection('password')}
            style={styles.settingRow}
          >
            <View style={styles.settingIcon}>
              <Text style={styles.settingIconText}>●</Text>
            </View>
            <View style={styles.settingText}>
              <Text style={styles.settingTitle}>Đổi mật khẩu</Text>
              <Text style={styles.settingCaption}>Đăng xuất mọi thiết bị</Text>
            </View>
            <Text style={styles.settingArrow}>›</Text>
          </Pressable>
          {!!user.avatarUrl && (
            <Pressable
              disabled={busy}
              onPress={() =>
                Alert.alert('Gỡ ảnh đại diện?', undefined, [
                  { text: 'Giữ lại', style: 'cancel' },
                  {
                    text: 'Gỡ ảnh',
                    style: 'destructive',
                    onPress: () =>
                      void run(async () => {
                        const result = await api.authenticated<{
                          user: api.User;
                        }>('/users/me/avatar', undefined, 'DELETE');
                        onUser(result.user);
                      }, 'Đã gỡ ảnh đại diện.'),
                  },
                ])
              }
              style={styles.settingRow}
            >
              <View style={styles.settingIcon}>
                <Text style={styles.settingIconText}>×</Text>
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Gỡ ảnh đại diện</Text>
                <Text style={styles.settingCaption}>Dùng chữ cái thay thế</Text>
              </View>
              <Text style={styles.settingArrow}>›</Text>
            </Pressable>
          )}
          <View style={styles.accountDetails}>
            <Text style={styles.detailLabel}>EMAIL</Text>
            <Text selectable style={styles.detailValue}>
              {user.email}
            </Text>
            {!!user.createdAt && (
              <>
                <Text style={styles.detailLabel}>NGÀY THAM GIA</Text>
                <Text style={styles.detailValue}>
                  {new Intl.DateTimeFormat('vi-VN').format(
                    new Date(user.createdAt),
                  )}
                </Text>
              </>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.formCard}>
          <Pressable
            onPress={() => {
              setSection('main');
              setError('');
              setNotice('');
            }}
            style={styles.backLink}
          >
            <Text style={styles.backLinkText}>‹ Quay lại tài khoản</Text>
          </Pressable>
          {section === 'name' ? (
            <>
              <Text style={styles.formTitle}>Tên hiển thị</Text>
              <Text style={styles.fieldLabel}>Tên mới</Text>
              <TextInput
                editable={!busy}
                maxLength={100}
                onChangeText={setName}
                style={styles.input}
                value={name}
              />
              <Pressable
                disabled={
                  busy || !name.trim() || name.trim() === user.displayName
                }
                onPress={() =>
                  void run(async () => {
                    const result = await api.authenticated<{
                      user: api.User;
                    }>('/users/me', { displayName: name.trim() }, 'PATCH');
                    onUser(result.user);
                  }, 'Đã lưu tên hiển thị.')
                }
                style={[styles.primaryButton, busy && styles.disabled]}
              >
                <Text style={styles.primaryButtonText}>Lưu thay đổi</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.formTitle}>Đổi mật khẩu</Text>
              <Text style={styles.formHint}>
                Sau khi đổi, bạn sẽ đăng xuất trên tất cả thiết bị.
              </Text>
              {[
                ['Mật khẩu hiện tại', currentPassword, setCurrentPassword],
                ['Mật khẩu mới', newPassword, setNewPassword],
                ['Xác nhận mật khẩu mới', confirmPassword, setConfirmPassword],
              ].map(([label, value, setter]) => (
                <View key={label as string}>
                  <Text style={styles.fieldLabel}>{label as string}</Text>
                  <TextInput
                    editable={!busy}
                    maxLength={128}
                    onChangeText={setter as (value: string) => void}
                    secureTextEntry
                    style={styles.input}
                    value={value as string}
                  />
                </View>
              ))}
              <Pressable
                disabled={
                  busy ||
                  !currentPassword ||
                  newPassword.length < 8 ||
                  !confirmPassword
                }
                onPress={() => {
                  if (newPassword !== confirmPassword) {
                    setError('Mật khẩu xác nhận chưa khớp.');
                    return;
                  }
                  void run(async () => {
                    await api.authenticated('/auth/change-password', {
                      currentPassword,
                      newPassword,
                      confirmPassword,
                    });
                    await onLogout();
                  }, '');
                }}
                style={[styles.primaryButton, busy && styles.disabled]}
              >
                <Text style={styles.primaryButtonText}>Đổi mật khẩu</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
      <Pressable
        disabled={busy}
        onPress={() =>
          Alert.alert('Đăng xuất?', 'Phiên trên thiết bị này sẽ kết thúc.', [
            { text: 'Ở lại', style: 'cancel' },
            {
              text: 'Đăng xuất',
              style: 'destructive',
              onPress: () => void onLogout(),
            },
          ])
        }
        style={styles.logoutWide}
      >
        <Text style={styles.logoutWideText}>Đăng xuất</Text>
      </Pressable>
    </ScrollView>
  );
}
