import './globals.css';

export const metadata = {
  title: 'Buzzer Pro',
  description: 'Office Trivia Arena',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950">{children}</body>
    </html>
  );
}