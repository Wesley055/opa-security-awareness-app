type LogoProps = {
  className?: string;
  size?: number;
};

/**
 * OPA logo mark. The SVG is inlined rather than loaded from /public so it
 * renders immediately with no image optimisation config, and so its colours
 * can be adjusted from CSS later if needed.
 */
export function LogoMark({ className, size = 28 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="OPA"
    >
      <title>OPA</title>
      <rect width="64" height="64" rx="15" fill="#0B1F3A" />
      <g fill="none" stroke="#17C9B2" strokeLinecap="round" opacity="0.9">
        <path d="M17.5 44.5a20 20 0 0 1 0-25" strokeWidth="3" />
        <path d="M46.5 19.5a20 20 0 0 1 0 25" strokeWidth="3" />
      </g>
      <path
        d="M32 13c-6.6 0-12 5.3-12 11.9 0 8.6 12 21.1 12 21.1s12-12.5 12-21.1C44 18.3 38.6 13 32 13z"
        fill="#FF5A36"
      />
      <circle cx="32" cy="24.7" r="4.6" fill="#0B1F3A" />
    </svg>
  );
}
