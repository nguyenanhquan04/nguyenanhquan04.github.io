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
    "sửa nội dung này trong assets/js/config.js",
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
    { type: "github", url: "https://github.com/nguyenanhquangramar" },
    { type: "discord", copy: "ten_discord_cua_ban", label: "Discord (bấm để sao chép)" },
    // { type: "instagram", url: "https://instagram.com/..." },
    // { type: "tiktok", url: "https://tiktok.com/@..." },
    // { type: "youtube", url: "https://youtube.com/@..." },
    // { type: "facebook", url: "https://facebook.com/..." },
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
    discordId: "",
    showDiscord: true,      // Thẻ trạng thái Discord + game/app đang dùng
    showSpotify: true,      // Thẻ bài hát Spotify đang nghe (lấy qua Discord)
    github: "nguyenanhquangramar", // Tên tài khoản GitHub cho thẻ GitHub. Để trống để ẩn
  },

  /* ---------- Nhạc nền ---------- */
  music: {
    src: "",                // ví dụ "assets/media/song.mp3". Để trống = không có nhạc
    title: "",              // Tên bài hiển thị trên trình phát
    volume: 0.35,           // 0 → 1
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
