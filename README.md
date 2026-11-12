# Trang bio cá nhân (phong cách zyo.lol / guns.lol)

Trang bio-link tĩnh, chỉ dùng HTML/CSS/JS thuần, không cần build. Chạy được ngay trên GitHub Pages.

## Tính năng

Giao diện kiểu game pixel 8-bit, một trang đơn:

- Màn hình "nhấn để vào" kiểu PRESS START (để trình duyệt cho phép phát nhạc)
- Nền bầu trời đêm pixel: dải màu, trăng khuyết, đồi, sao vuông lấp lánh và thỉnh thoảng có sao băng (hoặc tuyết rơi, video, ảnh)
- Các khung viền pixel kiểu menu RPG, con trỏ chuột pixel, chữ pixel có đủ dấu tiếng Việt (VT323, Tiny5)
- **Người chơi 1**: avatar Discord trong khung tròn pixel, chấm trạng thái, huy hiệu, bio gõ chữ trong hộp thoại RPG, mạng xã hội
- **Người yêu tôi**: thẻ hồng, bấm vào mở trang riêng màu hồng kem của cô ấy
- **Máy nghe nhạc cassette**: cuộn băng quay khi phát, băng chạy từ cuộn trái sang cuộn phải theo bài hát, tua, trộn bài, lặp lại, âm lượng, danh sách bài có con trỏ ▶ kiểu menu game, điều khiển bằng phím media của máy
- **Game tôi chơi** (WuWa · Genshin · HSR): tab chuyển có hiệu ứng quét màn hình 8-bit, thanh EXP cho cấp, bảng chỉ số kiểu RPG, nhân vật trưng bày, chấm "Đang chơi" khi Discord thấy bạn đang mở game
- **Đang làm gì**: Discord, game đang mở, Spotify (có thanh tiến trình), GitHub; tự cập nhật không cần tải lại trang
- Tự co giãn trên điện thoại, tôn trọng cài đặt "giảm chuyển động" của hệ điều hành

## Cấu trúc

```
index.html            Khung trang + thẻ meta (tiêu đề, mô tả khi chia sẻ link)
assets/js/config.js   ← File bạn cần sửa: thông tin, link, màu, hiệu ứng
assets/js/main.js     Logic: hiệu ứng, Discord (Lanyard), GitHub API
assets/css/style.css  Giao diện
assets/media/         Nơi để nhạc, video nền, ảnh
assets/data/          games.json do GitHub Actions tạo (stats Genshin/HSR)
scripts/              fetch-games.mjs: lấy stats game từ Enka.Network
.github/workflows/    games.yml: chạy fetch-games.mjs mỗi 6 giờ
.nojekyll             Báo GitHub Pages phục vụ file nguyên trạng
```

## Tùy chỉnh

Mở `assets/js/config.js` và sửa các mục. Mỗi dòng đều có chú thích.

Sửa thêm `<title>` và các thẻ `og:` trong `index.html` để link preview trên Discord/Facebook hiện đúng tên.

### Bật thẻ Discord và Spotify

Trang dùng [Lanyard](https://github.com/Phineas/lanyard) để đọc trạng thái Discord công khai.

1. Tham gia server Discord của Lanyard: https://discord.gg/UrXF2cfJ7F (bắt buộc, không cần làm gì thêm).
2. Trong Discord: **Cài đặt người dùng → Nâng cao → bật Chế độ nhà phát triển**.
3. Chuột phải vào tên của bạn → **Sao chép ID người dùng**.
4. Dán vào `integrations.discordId` trong `config.js`.

Thẻ Spotify hiện khi bạn đã liên kết Spotify với Discord và bật "Hiển thị Spotify làm trạng thái".

Khi Lanyard có dữ liệu, tên và avatar trên trang sẽ lấy từ Discord. Muốn giữ cố định thì điền `name` và `avatar` trong `config.js`.

### Thẻ "Người yêu tôi"

Mục `lover` trong `config.js` hiện một thẻ màu hồng với trạng thái Discord trực tiếp của người ấy: online/offline, custom status, bài đang nghe hoặc game đang chơi. Người ấy cũng phải tham gia server Lanyard ở trên. Nếu chưa tham gia, thẻ chỉ hiện tên. Để `discordId: ""` nếu muốn ẩn thẻ.

Bấm vào thẻ sẽ mở trang riêng màu hồng kem của người ấy (link thẳng: `/#love`). Cấu hình trong `lover.page`:

- `since`: ngày bắt đầu yêu (`"2026-10-23"`) → bộ đếm "X ngày bên nhau"
- `message`, `letterTitle`: lá thư
- `photos`: ảnh kiểu polaroid
- `music.tracks`: bài hát riêng. Khi trang mở, nhạc chính tạm dừng và bài này phát; đóng trang thì nhạc chính phát tiếp

Mục nào để trống sẽ được ẩn. Đặt `page: false` để thẻ mở hồ sơ Discord như cũ.

### Thẻ game

Điền vào `games.list` trong `config.js`:

- **Genshin Impact** và **Honkai: Star Rail**: chỉ cần `uid`. Workflow `.github/workflows/games.yml` chạy `scripts/fetch-games.mjs` mỗi 6 giờ (và mỗi khi `config.js` đổi), lấy stats từ [Enka.Network](https://enka.network) rồi ghi vào `assets/data/games.json`. Trang phải đọc qua file này vì Enka không cho trình duyệt gọi thẳng từ trang khác. Trong game, nhớ bật hiện nhân vật trưng bày trên hồ sơ.
- **Wuthering Waves**: không có API công khai nên bạn tự điền `nickname`, `level`, `stats`, `characters`.
- `stats: [{ label, value }]` dùng được cho cả 3 game, hiện thêm sau stats tự động.

Chạy tay: tab **Actions** → **Update game stats** → **Run workflow**.

### Thêm bài vào playlist

1. Tải file mp3 lên thư mục `assets/media/` (trên GitHub: **Add file → Upload files**).
2. Thêm một dòng vào `music.tracks` trong `config.js`:

```js
tracks: [
  { src: "assets/media/Midnight - BEAST.mp3", title: "Midnight (별 헤는 밤)", artist: "BEAST", cover: "https://..." },
  { src: "assets/media/bai-moi.mp3", title: "Tên bài", artist: "Ca sĩ", cover: "assets/media/bia.jpg" },
],
```

`cover` là ảnh bìa hiện ở giữa đĩa. Để trống thì đĩa dùng nhãn màu. `shuffle` và `repeat` (`"all"`, `"one"`, `"off"`) đặt chế độ mặc định khi mở trang.

### Video / ảnh nền

```js
background: { video: "assets/media/bg.mp4", ... },
```

Nên giữ file nhỏ (nhạc mp3 vài MB, video mp4 dưới ~15 MB) để trang tải nhanh. GitHub chặn file trên 100 MB.

### Sau khi sửa CSS/JS

Tăng số `?v=` ở cuối các đường dẫn `style.css`, `config.js`, `main.js` trong `index.html` (ví dụ `?v=2` → `?v=3`). Người xem sẽ nhận bản mới ngay, không phải đợi cache 10 phút của GitHub Pages.

## Đăng lên GitHub Pages

**Cách 1: trang chính `https://<tên-github>.github.io`**

1. Tạo repo tên chính xác là `<tên-github>.github.io` (để Public).
2. Đẩy toàn bộ nội dung thư mục này lên nhánh `main`.
3. Vào **Settings → Pages → Build and deployment**, chọn **Deploy from a branch**, nhánh `main`, thư mục `/ (root)`.
4. Đợi 1–2 phút rồi mở `https://<tên-github>.github.io`.

**Cách 2: repo bất kỳ** (ví dụ `bio`) → địa chỉ sẽ là `https://<tên-github>.github.io/bio/`. Các bước giống hệt.

## Chạy thử trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Ghi chú

- Thẻ GitHub gọi API công khai của GitHub (giới hạn 60 lượt/giờ cho mỗi người xem, đã có cache 10 phút).
- Biểu tượng: [Font Awesome](https://fontawesome.com) (free). Phông chữ: [Outfit](https://fonts.google.com/specimen/Outfit).
- Chỉ dùng nhạc bạn có quyền sử dụng.
