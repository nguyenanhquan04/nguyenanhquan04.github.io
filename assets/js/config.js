/*
 * ======================================================================
 *  CẤU HÌNH TRANG BIO — chỉ cần sửa file này
 * ======================================================================
 *  - Chuỗi để trống ("") nghĩa là tắt tính năng đó hoặc tự lấy từ Discord/GitHub.
 *  - File media (nhạc, video nền, ảnh) nên đặt trong thư mục assets/media/
 *    rồi ghi đường dẫn tương đối, ví dụ: "assets/media/song.mp3".
 */
window.PROFILE = {
  /* ---------- Thông tin cá nhân ---------- */
  name: "",                 // Tên hiển thị. Để trống = lấy tên Discord, rồi tới tên GitHub
  username: "",             // Dòng nhỏ dưới tên, ví dụ "@minh". Để trống = @tài-khoản GitHub/Discord
  avatar: "",               // URL ảnh đại diện. Để trống = avatar Discord, rồi tới avatar GitHub
  location: "Việt Nam",     // Để trống để ẩn

  // Các dòng giới thiệu, sẽ được gõ lần lượt (hiệu ứng máy đánh chữ)
  bio: [
    "xin chào 👋",
    "code · music · games",
  ],

  // Huy hiệu cạnh tên. icon = class Font Awesome (https://fontawesome.com/search?ic=free)
  badges: [
    { icon: "fa-solid fa-code", label: "Developer" },
    { icon: "fa-solid fa-headphones", label: "Music lover" },
    { icon: "fa-solid fa-gamepad", label: "Gamer" },
  ],

  /* ---------- Mạng xã hội (hàng icon) ----------
   * type có sẵn: github, discord, x, instagram, tiktok, youtube, facebook, spotify,
   *              soundcloud, steam, telegram, twitch, reddit, email, website
   * - Dùng "url" để mở link.
   * - Dùng "copy" để bấm vào là sao chép chữ (hợp với tên Discord).
   * - Có thể ghi đè icon bằng "icon": "fa-brands fa-..."
   */
  socials: [
    { type: "discord", copy: "_veritas.haze", label: "Discord: _veritas.haze (bấm để sao chép)" },
    { type: "tiktok", url: "https://www.tiktok.com/@arli_flawless", label: "TikTok: @arli_flawless" },
    { type: "facebook", url: "https://www.facebook.com/veritas.haze", label: "Facebook" },
    { type: "github", url: "https://github.com/nguyenanhquan04" },
    // { type: "instagram", url: "https://instagram.com/..." },
    // { type: "youtube", url: "https://youtube.com/@..." },
    // { type: "email", url: "mailto:ban@example.com" },
  ],

  // Nút liên kết lớn (kiểu Linktree). Để mảng rỗng [] để ẩn.
  links: [
    // { label: "Blog của tôi", url: "https://...", icon: "fa-solid fa-pen-nib" },
  ],

  /* ---------- Thẻ hoạt động trực tiếp ---------- */
  integrations: {
    // Discord User ID (Cài đặt > Nâng cao > bật Developer Mode, rồi chuột phải vào tên > Copy User ID).
    // BẮT BUỘC: tham gia server Lanyard https://discord.gg/UrXF2cfJ7F thì trạng thái mới hiện.
    discordId: "109027621051871232",
    showDiscord: true,      // Thẻ trạng thái Discord + game/app đang dùng
    showSpotify: true,      // Thẻ bài hát Spotify đang nghe (lấy qua Discord)
    github: "nguyenanhquan04", // Tên tài khoản GitHub cho thẻ GitHub. Để trống để ẩn
  },

  /* ---------- Thẻ người yêu ----------
   * Hiện trạng thái Discord trực tiếp của người ấy (online, custom status, đang nghe/chơi gì).
   * Người ấy cũng phải tham gia server Lanyard thì trạng thái mới hiện;
   * nếu chưa, thẻ vẫn hiện tên và link tới hồ sơ Discord.
   * Xoá discordId (để "") để ẩn thẻ này.
   */
  lover: {
    label: "Người yêu tôi",
    discordId: "1379346205212934144",
    username: "eswan_17",
    name: "",               // Tên hiển thị. Để trống = lấy tên Discord của người ấy

    // Trang riêng màu hồng kem, mở khi bấm vào thẻ (link thẳng: nguyenanhquan.tech/#love).
    // Đặt page: false để thẻ mở hồ sơ Discord như cũ. Mục nào để trống sẽ được ẩn.
    page: {
      since: "2026-10-23",  // Ngày bắt đầu yêu, dạng "2025-02-14" → hiện bộ đếm "bên nhau X ngày"
      letterTitle: "Gửi em",
      message: "",          // Lời nhắn. Xuống dòng bằng \n
      photos: [],           // Ảnh: ["assets/media/anh1.jpg", "assets/media/anh2.jpg"]

      // Nhạc riêng: khi trang của cô ấy mở, nhạc chính tạm dừng và bài này phát.
      // Đóng trang thì nhạc chính phát tiếp. Để tracks: [] nếu không dùng.
      music: {
        label: "Bài hát dành cho em",
        tracks: [
          // { src: "assets/media/ten-file.mp3", title: "Tên bài", artist: "Ca sĩ", cover: "" },
        ],
      },
    },
  },

  /* ---------- Trình phát nhạc (playlist, đĩa xoay) ----------
   * Thêm bài: tải file mp3 vào assets/media/ rồi thêm một dòng vào "tracks".
   * - src:    đường dẫn file nhạc (bắt buộc)
   * - title:  tên bài. Để trống = lấy tên file
   * - artist: ca sĩ (không bắt buộc)
   * - cover:  ảnh bìa hiện ở giữa đĩa (URL hoặc "assets/media/anh.jpg"). Để trống = nhãn đĩa màu
   * Xoá hết bài (tracks: []) để ẩn trình phát.
   */
  music: {
    volume: 0.35,           // Âm lượng ban đầu, 0 → 1
    shuffle: false,         // true = trộn bài
    repeat: "all",          // "all" = lặp cả danh sách | "one" = lặp một bài | "off" = hết danh sách thì dừng
    tracks: [
      {
        src: "assets/media/Midnight - BEAST.mp3",
        title: "Midnight (별 헤는 밤)",
        artist: "BEAST",
        cover: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/23/1a/63/231a634a-e6d3-a22d-d9a6-3281d4b91de8/01_Midnight.jpg/300x300bb.jpg",
      },
      // { src: "assets/media/ten-file.mp3", title: "Tên bài", artist: "Ca sĩ", cover: "" },
    ],
  },

  /* ---------- Nền ---------- */
  background: {
    video: "",              // ví dụ "assets/media/bg.mp4" (ưu tiên hơn ảnh)
    image: "",              // ví dụ "assets/media/bg.jpg" hoặc một URL
    dim: 0.5,               // Độ tối phủ lên nền, 0 → 1
    particles: "stars",     // "stars" | "snow" | "none"
  },

  /* ---------- Giao diện & hiệu ứng ---------- */
  theme: {
    accent: "#a78bfa",      // Màu chủ đạo
    accent2: "#38bdf8",     // Màu phụ (gradient)
    cardOpacity: 0.38,      // Độ đậm nền thẻ, 0 → 1
    blur: 18,               // Độ mờ kính (px)
    nameEffect: "glow",     // "glow" | "gradient" | "none"
  },

  effects: {
    enterScreen: true,      // Màn hình "nhấn để vào" (cần nếu muốn tự phát nhạc)
    enterText: "nhấn để vào",
    tilt: true,             // Thẻ nghiêng 3D theo chuột
    cursor: true,           // Con trỏ phát sáng
    typewriter: true,       // Hiệu ứng gõ chữ cho bio
    animatedTitle: true,    // Tiêu đề tab tự gõ chữ
  },

  footer: "",               // Dòng chữ nhỏ cuối trang. Để trống để ẩn
};
