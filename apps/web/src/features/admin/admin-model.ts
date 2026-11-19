export type AdminSection = 'overview' | 'users' | 'reports' | 'activity';
export const sections: {
  id: AdminSection;
  label: string;
  description: string;
}[] = [
  {
    id: 'overview',
    label: 'Tổng quan',
    description:
      'Thống kê vận hành thời gian thực, phân tích lưu lượng và xuất báo cáo hệ thống.',
  },
  {
    id: 'users',
    label: 'Người dùng',
    description:
      'Quản lý tài khoản, phân quyền quản trị, tra cứu metadata và trích xuất danh sách.',
  },
  {
    id: 'reports',
    label: 'Báo cáo vi phạm',
    description:
      'Tiếp nhận, xác minh bằng chứng snapshot và xử lý báo cáo vi phạm cộng đồng.',
  },
  {
    id: 'activity',
    label: 'Audit & Tuân thủ',
    description:
      'Tra cứu nhật ký audit_logs bất biến, trích xuất hồ sơ khiếu nại và chính sách lưu trữ.',
  },
];
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'active' | 'blocked';
  joined: string;
  color: string;
}
export const initialUsers: AdminUser[] = [
  {
    id: 'PP001',
    name: 'Nguyễn Minh Anh',
    email: 'minhanh@example.com',
    role: 'Thành viên',
    status: 'active',
    joined: '12/11/2026',
    color: 'peach',
  },
  {
    id: 'PP002',
    name: 'Trần Hoàng Nam',
    email: 'hoangnam@example.com',
    role: 'Thành viên',
    status: 'active',
    joined: '12/11/2026',
    color: 'sage',
  },
  {
    id: 'PP003',
    name: 'Lê Thảo Vy',
    email: 'thaovy@example.com',
    role: 'Quản trị viên',
    status: 'active',
    joined: '11/11/2026',
    color: 'lilac',
  },
  {
    id: 'PP004',
    name: 'Phạm Đức Huy',
    email: 'duchuy@example.com',
    role: 'Thành viên',
    status: 'blocked',
    joined: '10/11/2026',
    color: 'sand',
  },
  {
    id: 'PP005',
    name: 'Võ Ngọc Linh',
    email: 'ngoclinh@example.com',
    role: 'Thành viên',
    status: 'active',
    joined: '10/11/2026',
    color: 'peach',
  },
  {
    id: 'PP006',
    name: 'Đặng Gia Bảo',
    email: 'giabao@example.com',
    role: 'Thành viên',
    status: 'active',
    joined: '09/11/2026',
    color: 'sage',
  },
];
export const initialReports = [
  {
    id: 'BC001',
    name: 'Phạm Đức Huy',
    reason: 'Tin nhắn rác',
    detail: 'Gửi liên tiếp nội dung quảng cáo trong nhóm học tập.',
    priority: 'Cao',
    resolved: false,
  },
  {
    id: 'BC002',
    name: 'Trần Hoàng Nam',
    reason: 'Nội dung không phù hợp',
    detail: 'Người dùng yêu cầu xem xét ngôn từ trong cuộc trò chuyện.',
    priority: 'Vừa',
    resolved: false,
  },
  {
    id: 'BC003',
    name: 'Võ Ngọc Linh',
    reason: 'Giả mạo tài khoản',
    detail: 'Tên và ảnh đại diện bị báo cáo là trùng với người khác.',
    priority: 'Vừa',
    resolved: false,
  },
];
