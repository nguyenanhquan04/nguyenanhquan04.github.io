# Cloudflare Worker: stats game trực tiếp

`games-worker.mjs` lấy stats Genshin Impact và Honkai: Star Rail từ [Enka.Network](https://enka.network) mỗi khi có người mở trang. Mỗi hồ sơ chỉ được hỏi Enka tối đa 10 phút một lần (có cache), nên số liệu trên trang trễ nhiều nhất khoảng 10 phút. Không cần GitHub Actions.

- UID được đọc từ `assets/js/config.js` trên trang thật (`games.list[].uid`). Đổi UID ở đó là đủ, không phải sửa Worker.
- Worker chỉ lấy đúng các UID đó, người khác không dùng nó để tra UID bất kỳ được.
- Nếu Enka lỗi hoặc giới hạn lượt gọi, Worker trả bản lưu gần nhất (giữ 30 ngày).
- Gói Workers miễn phí: 100.000 lượt/ngày, thừa sức cho trang cá nhân.

## Cài đặt (khoảng 5 phút)

### 1. Tạo Worker

1. Mở https://dash.cloudflare.com → **Workers & Pages** (menu trái, mục **Compute**).
2. Bấm **Create application** → chọn **Start with Hello World!** (hoặc **Create Worker**).
3. Đặt tên `bio-stats` → **Deploy**.
4. Bấm **Edit code**. Xoá hết code mẫu trong `worker.js`, dán **toàn bộ** nội dung file `games-worker.mjs`.
5. Bấm **Deploy** (góc trên bên phải).

### 2. Gắn tên miền riêng (bắt buộc)

Cache của Worker **không hoạt động** trên địa chỉ `*.workers.dev`. Không có cache thì mỗi lượt xem trang đều gọi Enka và rất dễ bị giới hạn. Vì vậy phải gắn tên miền riêng:

1. Trong Worker `bio-stats` → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
2. Nhập `stats.nguyenanhquan.tech` → **Add domain**. Cloudflare tự tạo bản ghi DNS và chứng chỉ HTTPS, mất 1–5 phút.
3. Mở https://stats.nguyenanhquan.tech/ trên trình duyệt. Phải thấy một đoạn JSON bắt đầu bằng `{"updatedAt":...,"genshin":{...`.

### 3. Báo cho trang biết địa chỉ Worker

Trong `assets/js/config.js`, mục `games`, điền:

```js
liveUrl: "https://stats.nguyenanhquan.tech/",
```

(Hoặc nhắn Kiro làm bước này.)

## Sửa Worker sau này

Nếu `games-worker.mjs` trong repo thay đổi, mở lại **Edit code**, dán bản mới và **Deploy**. Worker không tự cập nhật theo repo.

## Kiểm tra nhanh

- `https://stats.nguyenanhquan.tech/` → JSON có `genshin` và `hsr`.
- Có trường `"stale": true` → Enka đang lỗi, Worker trả bản lưu cũ. Trường `errors` cho biết lý do.
- Trả lỗi 502 → Worker không đọc được `config.js` từ trang, hoặc chưa từng lấy được dữ liệu nào.
