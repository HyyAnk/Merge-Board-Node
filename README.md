# MergeBoard

MergeBoard là ứng dụng Vite/React chạy hoàn toàn trong trình duyệt. Project, ảnh và text được lưu trực tiếp vào folder local bằng File System Access API; Vercel chỉ host giao diện và không lưu dữ liệu project.

## Chạy local

Yêu cầu Node.js LTS và Chrome hoặc Microsoft Edge.

```powershell
npm install
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal, bấm **Chọn folder project**, rồi cấp quyền đọc/ghi. Folder được ghi nhớ trong trình duyệt; sau khi mở lại, trình duyệt có thể yêu cầu bấm **Cho phép truy cập** một lần nữa.

## Deploy lên Vercel

1. Push repository lên GitHub.
2. Trong Vercel, chọn **Add New → Project** và import repository.
3. Vercel sẽ nhận Vite, chạy `npm run build` và dùng folder output `dist` từ `vercel.json`.
4. Mở domain HTTPS do Vercel cấp bằng Chrome/Edge và chọn folder local.

Không cần khai báo database, Blob Storage, API key hay Environment Variable.

Giao diện mặc định dùng English. Có thể đổi sang **Tiếng Việt** tại **Settings → Language**; lựa chọn được ghi nhớ trong trình duyệt.

## Dữ liệu local

Mỗi project giữ định dạng portable:

```text
Folder-cha/
  Tên-project/
    project.json
    assets/
    texts/
```

Chọn một folder cha đang chứa các project theo định dạng trên để MergeBoard tự quét và tải lại. Website không thể biết hoặc hiển thị đường dẫn đầy đủ như `D:\Projects`; đây là giới hạn bảo mật của trình duyệt.

## Trình duyệt

- Hỗ trợ: Chrome và Microsoft Edge desktop.
- Firefox và Safari hiện không phù hợp với luồng đọc/ghi folder này.
- File System Access API cần HTTPS khi deploy; domain Vercel đã đáp ứng yêu cầu này.
