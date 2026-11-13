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

## Thêm Wuthering Waves (tuỳ chọn)

WuWa **không** có API công khai theo UID như Genshin/HSR. Worker lấy stats qua API launcher chính chủ của Kuro, bằng **auto-login token** (cùng luồng như [kuro.py](https://github.com/Wuthery/kuro.py)).

> **Mật khẩu của bạn KHÔNG bao giờ được lưu ở đây.** Bạn chạy notebook kuro.py **một lần** (nó tự giải captcha) để lấy token, rồi dán token đó vào Worker. Worker tự xoay (rotate) và lưu token mới vào KV, nên token seed chỉ dùng để khởi động.

### 1. Lấy auto-login token (chạy 1 lần)

1. Mở notebook Colab của kuro.py: https://gist.github.com/SimpNick6703/c7e4d18f569b2808cd4d8dea808f0a8a
2. Chạy, đăng nhập bằng tài khoản Kuro của bạn, giải captcha khi được hỏi.
3. Lấy **hai** giá trị notebook in ra và giữ lại:
   - `auto_token` (chuỗi auto-login token)
   - `device_id` (UUID của thiết bị đã đăng nhập — phải giữ nguyên, token gắn với đúng device id này)

### 2. Tạo KV namespace

1. Dashboard → **Storage & Databases** → **KV** → **Create a namespace**.
2. Đặt tên `wuwa-kv` → **Add**.
3. Mở Worker `bio-stats` → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - **Variable name:** `WUWA_KV`  (đúng chữ hoa)
   - **KV namespace:** chọn `wuwa-kv` vừa tạo → **Deploy**.

### 3. Khai báo token cho Worker

Trong Worker `bio-stats` → **Settings** → **Variables and Secrets** → **Add**:

| Tên | Loại | Giá trị |
| --- | --- | --- |
| `KURO_AUTO_TOKEN` | **Secret** (Encrypt) | `auto_token` ở bước 1 |
| `KURO_DEVICE_ID` | **Secret** (Encrypt) | `device_id` ở bước 1 |
| `KURO_REGION` | Text (tuỳ chọn) | ví dụ `Europe` — ép đúng 1 region; bỏ trống thì Worker tự chọn tài khoản level cao nhất |

Bấm **Deploy** sau khi thêm.

### 4. Dán lại code Worker rồi Deploy

File `games-worker.mjs` đã có phần WuWa. Vào **Edit code**, dán lại **toàn bộ** nội dung mới nhất và **Deploy** (xem [Sửa Worker sau này](#sửa-worker-sau-này)).

### 5. Kiểm tra

- Mở `https://stats.nguyenanhquan.tech/` → JSON phải có thêm khối `wuwa` với `level`, `stats` (Union/World/nhân vật/ngày/Sonance).
- Nếu `wuwa` có `"stale": true` kèm `errors` → chuỗi Kuro đang lỗi (thường là **token hết hạn**). Chạy lại notebook bước 1 để lấy token mới, cập nhật lại `KURO_AUTO_TOKEN` ở bước 3.

> **Lưu ý:** phần crypto + toàn bộ chuỗi login đã được kiểm chứng khớp byte-for-byte với kuro.py và chạy qua mock đầy đủ, **nhưng chưa chạy thật với tài khoản Kuro thật** (vì cần captcha tương tác). Nếu lần đầu lỗi, gần như chắc là token/device id, chạy lại notebook là xong.

## Sửa Worker sau này

Nếu `games-worker.mjs` trong repo thay đổi, mở lại **Edit code**, dán bản mới và **Deploy**. Worker không tự cập nhật theo repo.

## Kiểm tra nhanh

- `https://stats.nguyenanhquan.tech/` → JSON có `genshin` và `hsr`.
- Có trường `"stale": true` → Enka đang lỗi, Worker trả bản lưu cũ. Trường `errors` cho biết lý do.
- Trả lỗi 502 → Worker không đọc được `config.js` từ trang, hoặc chưa từng lấy được dữ liệu nào.
