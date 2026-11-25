import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Đã xảy ra lỗi không mong muốn.',
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  override render() {
    if (this.state.hasError) {
      let friendlyMessage = 'Hệ thống gặp sự cố trong quá trình xử lý dữ liệu.';
      let technicalDetail = this.state.errorMessage;

      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && typeof parsed.error === 'string') {
          if (parsed.error.toLowerCase().includes('permission') || parsed.error.toLowerCase().includes('insufficient')) {
            friendlyMessage = 'Bạn không có quyền truy cập hoặc thao tác trên dữ liệu này theo quy tắc bảo mật.';
          }
          technicalDetail = `${parsed.operationType?.toUpperCase() || 'OP'} ${parsed.path || ''} — ${parsed.error}`;
        }
      } catch {
        // Plain error message
      }

      return (
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h1 className="text-base font-semibold text-slate-900">
                  Không thể hoàn tất thao tác
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {friendlyMessage}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-600 break-words">
              {technicalDetail}
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tải lại trang</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
