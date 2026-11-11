# Trang bio cá nhân (phong cách zyo.lol / guns.lol)

Trang bio-link tĩnh, chỉ dùng HTML/CSS/JS thuần, không cần build. Chạy được ngay trên GitHub Pages.

## Tính năng

- Màn hình "nhấn để vào" (để trình duyệt cho phép tự phát nhạc)
- Nền video, ảnh hoặc gradient động, kèm hiệu ứng sao lấp lánh hoặc tuyết rơi
- Thẻ kính mờ nghiêng 3D theo chuột, con trỏ phát sáng
- Avatar có chấm trạng thái Discord và khung trang trí avatar (nếu bạn có)
- Tên phát sáng / gradient, huy hiệu có tooltip, bio gõ chữ tự động, tiêu đề tab tự gõ
- Hàng icon mạng xã hội (bấm để mở link hoặc sao chép tên Discord)
- Thẻ hoạt động trực tiếp, tự cập nhật không cần tải lại trang:
  - **Discord**: trạng thái online, custom status, game/app đang dùng kèm thời gian
  - **Spotify**: bài đang nghe, ảnh album, thanh tiến trình
  - **GitHub**: số repo, follower, tổng sao
- Trình phát nhạc nền (phát/tạm dừng, âm lượng)
- Tự co giãn trên điện thoại, tôn trọng cài đặt "giảm chuyển động" của hệ điều hành

## Cấu trúc

```
index.html            Khung trang + thẻ meta (tiêu đề, mô tả khi chia sẻ link)
assets/js/config.js   ← File bạn cần sửa: thông tin, link, màu, hiệu ứng
assets/js/main.js     Logic: hiệu ứng, Discord (Lanyard), GitHub API
assets/css/style.css  Giao diện
assets/media/         Nơi để nhạc, video nền, ảnh
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

Mục `lover` trong `config.js` hiện một thẻ màu hồng với trạng thái Discord trực tiếp của người ấy: online/offline, custom status, bài đang nghe hoặc game đang chơi. Người ấy cũng phải tham gia server Lanyard ở trên. Nếu chưa tham gia, thẻ chỉ hiện tên và link tới hồ sơ Discord. Để `discordId: ""` nếu muốn ẩn thẻ.

### Thêm nhạc nền / video nền

Chép file vào `assets/media/` rồi ghi đường dẫn vào config:

```js
music: { src: "assets/media/song.mp3", title: "Tên bài hát", volume: 0.35 },
background: { video: "assets/media/bg.mp4", ... },
```

Nên giữ file nhỏ (nhạc mp3 vài MB, video mp4 dưới ~15 MB) để trang tải nhanh. GitHub chặn file trên 100 MB.

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
