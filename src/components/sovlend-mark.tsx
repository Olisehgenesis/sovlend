export function SovLendMark({ size = 30 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="sovlend-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="6" fill="currentColor" />
      <path d="M9 10.5C10.8 8.7 13.1 7.8 15.8 7.8H22L19.8 11.4H15.3C13.9 11.4 12.8 11.8 12 12.6C11.3 13.3 11.5 14.1 12.7 14.5L18.6 16.4C22 17.5 22.7 20.1 20.6 22.8C18.8 25 16.3 26.1 13.1 26.1H7.8L10.1 22.4H13.8C15.6 22.4 16.9 22 17.7 21.1C18.3 20.4 18.1 19.8 17 19.4L11 17.4C7.7 16.3 7 13.3 9 10.5Z" fill="#153529" />
      <path d="M19.3 4.5L14.7 13.8H18.5L14.1 22.2L24.1 11.5H20.1L23.6 4.5H19.3Z" fill="white" fillOpacity=".92" />
    </svg>
  );
}