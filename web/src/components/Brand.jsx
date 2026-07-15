// web/src/components/Brand.jsx
export default function Brand({ size = 'md' }) {
  const nameSize = size === 'lg' ? 26 : 20;
  return (
    <div className="brand">
      <div className="brand-badge">
        <img src="/kit-mark.png" alt="Kit" />
      </div>
      <span className="brand-name" style={{ fontSize: nameSize }}>Kit</span>
    </div>
  );
}
