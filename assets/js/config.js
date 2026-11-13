/*
 * ======================================================================
 *  CẤU HÌNH TRANG BIO — chỉ cần sửa file này
 * ======================================================================
 *  - Chuỗi để trống ("") nghĩa là tắt tính năng đó hoặc tự lấy từ Discord.
 *  - File media (nhạc, video nền, ảnh) nên đặt trong thư mục assets/media/
 *    rồi ghi đường dẫn tương đối, ví dụ: "assets/media/song.mp3".
 */
window.PROFILE = {
  /* ---------- Thông tin cá nhân ---------- */
  name: "",                 // Tên hiển thị. Để trống = lấy tên Discord (chưa tải được thì dùng <title> trong index.html)
  username: "",             // Dòng nhỏ dưới tên, ví dụ "@minh". Để trống = @tài-khoản Discord
  avatar: "",               // URL ảnh đại diện. Để trống = avatar Discord
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
    showDiscord: true,      // Trạng thái Discord ở Người chơi 1 + thông báo game/app đang dùng (góc dưới trái)
    showSpotify: true,      // Thông báo bài Spotify đang nghe (lấy qua Discord)
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
      photos: ["assets/media/1.jpg", "assets/media/2.jpg"], // Ảnh hiện kiểu polaroid

      // Nhạc riêng: khi trang của cô ấy mở, nhạc chính tạm dừng và bài này phát.
      // Đóng trang thì nhạc chính phát tiếp. Để tracks: [] nếu không dùng.
      music: {
        label: "Bài hát dành cho em",
        tracks: [
          { src: "assets/media/La Maritza (Piano Version) - Sylvie Vartan.mp3", title: "La Maritza (Piano Version)", artist: "Sylvie Vartan", cover: "" },
          // { src: "assets/media/ten-file.mp3", title: "Tên bài", artist: "Ca sĩ", cover: "" },
        ],
      },
    },
  },

  /* ---------- Khung game ----------
   * Genshin Impact và Honkai: Star Rail: chỉ cần điền UID. Stats (cấp, thành tựu, La Hoàn,
   * nhân vật trưng bày...) lấy từ Enka.Network qua Cloudflare Worker (liveUrl, cập nhật ~10 phút)
   * hoặc file games.json do GitHub Actions cập nhật mỗi 6 giờ (dataUrl, dự phòng).
   * Trong game nhớ bật hiện nhân vật trưng bày / chi tiết nhân vật trên hồ sơ.
   * Wuthering Waves: lấy stats (Union Level, nhân vật, ngày hoạt động, Sonance Casket...) từ
   *   API Kuro qua Cloudflare Worker — cần cài thêm, xem cloudflare/README.md. Không thì tự điền.
   * - stats: [{ label: "Tên", value: "Giá trị" }] hiện thêm sau stats tự động
   * - characters: ["Tên nhân vật", ...] (dùng cho WuWa)
   * Xoá một game khỏi list để ẩn tab đó. Xoá hết để ẩn thẻ game.
   */
  games: {
    title: "Game tôi chơi",
    liveUrl: "https://stats.nguyenanhquan.tech/", // Cloudflare Worker (xem cloudflare/README.md). Để "" để chỉ dùng games.json
    dataUrl: "https://raw.githubusercontent.com/nguyenanhquan04/nguyenanhquan04.github.io/main/assets/data/games.json",
    list: [
      {
        id: "wuwa",
        name: "Wuthering Waves",
        short: "WuWa",
        uid: "",            // để trống: Worker Kuro tự tìm tài khoản; điền nếu bạn có nhiều tài khoản
        server: "",         // ví dụ "Asia" / "SEA" (chỉ để hiển thị)
        nickname: "",       // để trống = lấy tên trong game từ Kuro
        level: "",          // để trống = lấy Union Level từ Kuro
        maxLevel: "",       // Cấp tối đa, để vẽ thanh EXP (Genshin 60 và HSR 70 đã có sẵn)
        stats: [],          // stats tự thêm, ví dụ [{ label: "Tháp Ảo Ảnh", value: "Tầng 4" }]
        characters: [],     // nhân vật khoe thêm (Kuro không trả nhân vật), ví dụ ["Camellya", "Jinhsi"]
      },
      // nickname: tên trong game. Để trống = lấy từ Enka (tên Genshin hiện tại toàn ký tự vô hình nên không hiện)
      { id: "genshin", name: "Genshin Impact", short: "Genshin", uid: "815953629", server: "", nickname: "", stats: [] },
      { id: "hsr", name: "Honkai: Star Rail", short: "HSR", uid: "801505978", server: "", stats: [] },
    ],
  },

  /* ---------- Máy nghe nhạc cassette ----------
   * Thêm bài: tải file mp3 vào assets/media/ rồi thêm một dòng vào "tracks".
   * - src:    đường dẫn file nhạc (bắt buộc)
   * - title:  tên bài. Để trống = lấy tên file
   * - artist: ca sĩ (không bắt buộc)
   * - cover:  ảnh bìa (URL hoặc "assets/media/anh.jpg"): hiện trên nhãn băng cassette và
   *           trong danh sách. Để trống = ô màu
   * Xoá hết bài (tracks: []) để ẩn máy nghe nhạc.
   */
  music: {
    playlistName: "Playlist của tôi", // Dòng "Đang phát từ ..." dưới băng cassette
    volume: 0.35,           // Âm lượng ban đầu, 0 → 1
    shuffle: false,         // true = trộn bài
    repeat: "all",          // "all" = lặp cả danh sách | "one" = lặp một bài | "off" = hết danh sách thì dừng
    tracks: [
      {
        src: "assets/media/Phố Mùa Đông - Hà Anh Tuấn.mp3",
        title: "Phố Mùa Đông",
        artist: "Hà Anh Tuấn",
        cover: "",
      },
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
    dim: 0.5,               // Độ tối phủ lên video/ảnh nền, 0 → 1 (không áp dụng cho bầu trời sao)
    particles: "stars",     // "stars" = bầu trời sao | "snow" = tuyết rơi | "none"
    shootingStars: true,    // Thỉnh thoảng có sao băng (khi particles = "stars")
  },

  /* ---------- Giao diện & hiệu ứng ---------- */
  theme: {
    accent: "#a78bfa",      // Màu chủ đạo (viền avatar, nhãn đĩa, thanh trượt...)
    accent2: "#38bdf8",     // Màu phụ
    nameEffect: "glow",     // Tên: "glow" = phát sáng | "gradient" = hai màu kiểu chữ game | "none"
  },

  effects: {
    enterScreen: true,      // Màn hình "nhấn để vào" (cần nếu muốn tự phát nhạc)
    enterText: "nhấn để vào",
    cursor: true,           // Con trỏ chuột kiểu pixel
    typewriter: true,       // Hiệu ứng gõ chữ cho bio
    animatedTitle: true,    // Tiêu đề tab tự gõ chữ
  },

  footer: "",               // Dòng chữ nhỏ cuối trang. Để trống để ẩn
};
