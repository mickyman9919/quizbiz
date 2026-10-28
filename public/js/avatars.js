// ใช้ร่วมกันทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์ (server.js require ไฟล์นี้เพื่อตรวจค่าอวาตาร์)
(function (root) {
  const AVATARS = [
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮',
    '🐷', '🐸', '🐵', '🐔', '🐧', '🐤', '🦆', '🦉', '🦄', '🐝', '🦋', '🐢',
    '🐙', '🦀', '🐳', '🐬', '🦈', '🐊', '🦖', '🐲', '🦔', '🦥', '🦦', '🐞',
    '👾', '🤖', '👻', '🎃', '🌵', '🍄', '🍉', '🍩', '🚀', '⚽',
  ];
  const COLORS = [
    '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee',
    '#60a5fa', '#818cf8', '#c084fc', '#f472b6', '#94a3b8', '#fde68a',
  ];
  const api = { AVATARS, COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KQ_AVATARS = api;
})(typeof window !== 'undefined' ? window : this);
