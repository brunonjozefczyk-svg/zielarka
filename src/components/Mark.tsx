export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <path
        d="M16 3c.4 3.2-.4 6.2-2.2 8.4C11.8 13.6 10 16.2 10 19.4c0 3.6 2.4 6.2 6 6.2s6-2.6 6-6.2c0-3.2-1.8-5.8-3.8-8C16.4 9.2 15.6 6.2 16 3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M16 13.5c2.2 1.4 3.8 3.4 4.2 5.8M16 13.5c-2.2 1.4-3.8 3.4-4.2 5.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M16 25.6V29"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
