/**
 * Gắn nhịp đếm lượt truy cập vào vòng đời của app.
 *
 * Đặt ngay trong BrowserRouter (ngoài ClassProvider) để đếm được CẢ trang đăng nhập và
 * đăng ký — khách rơi vào đó rồi bỏ đi cũng là một lượt truy cập cần biết.
 *
 * Nhịp tim 60 giây chỉ chạy khi tab đang hiển thị: tab nền không phải là người đang xem,
 * đếm nó vào "thời gian ở lại" là tự lừa mình.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackVisit } from '@/lib/visits';

const HEARTBEAT_MS = 60_000;

export default function VisitTracker() {
  const { pathname } = useLocation();
  const path = useRef(pathname);
  path.current = pathname;

  useEffect(() => {
    void trackVisit('view', pathname);
  }, [pathname]);

  // Interval dựng MỘT LẦN (đọc trang qua ref): nếu phụ thuộc pathname thì mỗi lần đổi
  // trang lại đặt lại đồng hồ, người bấm liên tục sẽ không bao giờ gửi được nhịp nào.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') void trackVisit('ping', path.current);
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, []);

  return null;
}
