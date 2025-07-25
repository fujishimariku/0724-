document.addEventListener('DOMContentLoaded', function() {
    const expiresAt = new Date(window.djangoData.expiresAt);
    const shareUrl = window.djangoData.shareUrl;
    
    // LINEブラウザ回避用のURLを生成
    function getExternalBrowserUrl(url) {
        // URLにパラメータを追加してLINEブラウザを回避
        const separator = url.includes('?') ? '&' : '?';
        return url + separator + 'openExternalBrowser=1';
    }
    
    // QRコード生成の改善版
    function generateQRCode() {
        const qrContainer = document.getElementById('qr-code');
        
        if (typeof QRCode === 'undefined') {
            console.warn('QRCodeライブラリが読み込まれていません。代替手段を使用します。');
            generateQRCodeAlternative();
            return;
        }
        
        // 既存のコンテンツをクリア
        qrContainer.innerHTML = '';
        
        try {
            // canvas要素を作成
            const canvas = document.createElement('canvas');
            qrContainer.appendChild(canvas);
            
            // QRコードには外部ブラウザ用URLを使用
            const qrUrl = getExternalBrowserUrl(shareUrl);
            
            QRCode.toCanvas(canvas, qrUrl, {
                width: 200,
                height: 200,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                },
                errorCorrectionLevel: 'M'
            }, function(error) {
                if (error) {
                    console.error('QRコード生成エラー:', error);
                    generateQRCodeAlternative();
                } else {
                    console.log('QRコード生成成功');
                }
            });
        } catch (error) {
            console.error('QRコード生成例外:', error);
            generateQRCodeAlternative();
        }
    }
    
    // 代替QRコード生成方法（複数の選択肢）
    function generateQRCodeAlternative() {
        const qrContainer = document.getElementById('qr-code');
        qrContainer.innerHTML = '';
        
        // 1. QR Server APIを試す
        if (!generateWithQRServer()) {
            // 2. Google Charts APIを試す
            if (!generateWithGoogleCharts()) {
                // 3. 最終的なフォールバック
                showQRCodeError();
            }
        }
    }
    
    // QR Server APIを使用
    function generateWithQRServer() {
        try {
            const qrContainer = document.getElementById('qr-code');
            const qrSize = 200;
            const qrUrl = getExternalBrowserUrl(shareUrl);
            const encodedUrl = encodeURIComponent(qrUrl);
            
            // QR Server API（より信頼性が高い）
            const qrServerUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodedUrl}&format=png&margin=10`;
            
            const img = document.createElement('img');
            img.src = qrServerUrl;
            img.alt = 'QRコード';
            img.style.width = qrSize + 'px';
            img.style.height = qrSize + 'px';
            img.style.border = '1px solid #ddd';
            img.style.borderRadius = '8px';
            img.loading = 'lazy';
            
            img.onload = function() {
                console.log('QR Server APIでQRコード生成成功');
            };
            
            img.onerror = function() {
                console.warn('QR Server APIが利用できません。Google Charts APIを試します。');
                generateWithGoogleCharts();
            };
            
            qrContainer.appendChild(img);
            return true;
        } catch (error) {
            console.error('QR Server API エラー:', error);
            return false;
        }
    }
    
    // Google Charts APIを使用（フォールバック）
    function generateWithGoogleCharts() {
        try {
            const qrContainer = document.getElementById('qr-code');
            const qrSize = 200;
            const qrUrl = getExternalBrowserUrl(shareUrl);
            const encodedUrl = encodeURIComponent(qrUrl);
            
            // Google Charts QR Code API
            const googleQRUrl = `https://chart.googleapis.com/chart?chs=${qrSize}x${qrSize}&cht=qr&chl=${encodedUrl}&choe=UTF-8&chld=M|2`;
            
            const img = document.createElement('img');
            img.src = googleQRUrl;
            img.alt = 'QRコード';
            img.style.width = qrSize + 'px';
            img.style.height = qrSize + 'px';
            img.style.border = '1px solid #ddd';
            img.style.borderRadius = '8px';
            img.loading = 'lazy';
            
            img.onload = function() {
                console.log('Google Charts APIでQRコード生成成功');
            };
            
            img.onerror = function() {
                console.error('Google Charts APIも利用できません');
                showQRCodeError();
            };
            
            // 既存のコンテンツをクリア
            qrContainer.innerHTML = '';
            qrContainer.appendChild(img);
            return true;
        } catch (error) {
            console.error('Google Charts API エラー:', error);
            return false;
        }
    }
    
    // QRコード生成エラー時の表示
    function showQRCodeError() {
        const qrContainer = document.getElementById('qr-code');
        const qrSize = 200;
        
        qrContainer.innerHTML = `
            <div class="text-center p-3 border rounded" style="width: ${qrSize}px; height: ${qrSize}px; display: flex; flex-direction: column; justify-content: center; align-items: center; background-color: #f8f9fa;">
                <i class="fas fa-qrcode fa-3x text-muted mb-2"></i>
                <small class="text-muted">QRコードを生成できませんでした</small>
                <small class="text-muted">URLを直接共有してください</small>
                <button class="btn btn-sm btn-outline-primary mt-2" onclick="retryQRGeneration()">
                    <i class="fas fa-redo"></i> 再試行
                </button>
            </div>
        `;
    }
    
    // QRコード生成の再試行
    window.retryQRGeneration = function() {
        const qrContainer = document.getElementById('qr-code');
        qrContainer.innerHTML = `
            <div class="text-center p-3" style="width: 200px; height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <i class="fas fa-spinner fa-spin fa-2x text-primary mb-2"></i>
                <small class="text-muted">QRコードを生成中...</small>
            </div>
        `;
        
        setTimeout(() => {
            generateQRCodeAlternative();
        }, 500);
    };
    
    // 改善されたQRライブラリ読み込み
    function loadQRCodeLibrary() {
        return new Promise((resolve, reject) => {
            // 既にライブラリが読み込まれている場合
            if (typeof QRCode !== 'undefined') {
                resolve();
                return;
            }
            
            const qrCodeCDNs = [
                'https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.5.3/qrcode.min.js',
                'https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js',
                'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
            ];
            
            let attemptIndex = 0;
            
            function tryLoadScript() {
                if (attemptIndex >= qrCodeCDNs.length) {
                    console.warn('全てのQRCodeライブラリの読み込みに失敗しました');
                    reject(new Error('QRCode library load failed'));
                    return;
                }
                
                const script = document.createElement('script');
                script.src = qrCodeCDNs[attemptIndex];
                script.async = true;
                
                script.onload = function() {
                    console.log('QRCodeライブラリ読み込み成功:', qrCodeCDNs[attemptIndex]);
                    // 少し待ってからライブラリが利用可能か確認
                    setTimeout(() => {
                        if (typeof QRCode !== 'undefined') {
                            resolve();
                        } else {
                            attemptIndex++;
                            tryLoadScript();
                        }
                    }, 100);
                };
                
                script.onerror = function() {
                    console.warn('QRCodeライブラリ読み込み失敗:', qrCodeCDNs[attemptIndex]);
                    attemptIndex++;
                    tryLoadScript();
                };
                
                document.head.appendChild(script);
            }
            
            tryLoadScript();
        });
    }
    
    // QRコード生成の開始
    function initQRCode() {
        const qrContainer = document.getElementById('qr-code');
        qrContainer.innerHTML = `
            <div class="text-center p-3" style="width: 200px; height: 200px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                <i class="fas fa-spinner fa-spin fa-2x text-primary mb-2"></i>
                <small class="text-muted">QRコードを生成中...</small>
            </div>
        `;
        
        // QRライブラリの読み込みを試す
        loadQRCodeLibrary()
            .then(() => {
                // ライブラリ読み込み成功
                generateQRCode();
            })
            .catch(() => {
                // ライブラリ読み込み失敗、代替手段を使用
                console.warn('QRライブラリ読み込み失敗、代替手段を使用');
                generateQRCodeAlternative();
            });
    }
    
    // ページ読み込み完了後にQRコード生成開始
    setTimeout(initQRCode, 100);
    
    // 改善されたURLコピー機能
    document.getElementById('copy-url').addEventListener('click', function() {
        const urlInput = document.getElementById('share-url');
        const button = this;
        const successMessage = document.getElementById('copy-success');
        const errorMessage = document.getElementById('copy-error');
        
        // メッセージをリセット
        successMessage.style.display = 'none';
        errorMessage.style.display = 'none';
        
        // コピーを実行（通常のURLをコピー）
        copyToClipboard(shareUrl, button, successMessage, errorMessage, urlInput);
    });
    
    // コピー機能（async/awaitを外部関数に移動）
    async function copyToClipboard(text, button, successMessage, errorMessage, urlInput) {
        try {
            // モダンなClipboard APIを試す
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                showCopySuccess(button, successMessage);
            } else {
                // フォールバック: 従来の方法
                urlInput.focus();
                urlInput.select();
                urlInput.setSelectionRange(0, 99999); // モバイル対応
                
                const successful = document.execCommand('copy');
                if (successful) {
                    showCopySuccess(button, successMessage);
                } else {
                    throw new Error('execCommand failed');
                }
            }
        } catch (error) {
            console.error('コピーに失敗しました:', error);
            showCopyError(button, errorMessage, urlInput);
        }
    }
    
    // コピー成功時の表示
    function showCopySuccess(button, successMessage) {
        const originalHTML = button.innerHTML;
        const originalClass = button.className;
        
        button.innerHTML = '<i class="fas fa-check"></i> コピー済み';
        button.className = 'btn btn-success';
        button.disabled = true;
        
        successMessage.style.display = 'block';
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.className = originalClass;
            button.disabled = false;
            successMessage.style.display = 'none';
        }, 3000);
    }
    
    // コピー失敗時の表示
    function showCopyError(button, errorMessage, urlInput) {
        errorMessage.style.display = 'block';
        
        // URLを選択状態にして手動コピーを促す
        urlInput.focus();
        urlInput.select();
        
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000);
    }
    
    // カウントダウン
    function updateCountdown() {
        const now = new Date();
        const timeLeft = expiresAt - now;
        
        if (timeLeft <= 0) {
            document.getElementById('countdown').textContent = '期限切れ';
            document.getElementById('countdown').className = 'countdown text-danger';
            return;
        }
        
        const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        let countdownText = '';
        if (days > 0) {
            countdownText = `${days}日 ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            countdownText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        document.getElementById('countdown').textContent = countdownText;
        
        // 残り時間が少ない場合の警告表示
        if (timeLeft < 60 * 60 * 1000) { // 1時間未満
            document.getElementById('countdown').className = 'countdown text-warning';
        } else if (timeLeft < 10 * 60 * 1000) { // 10分未満
            document.getElementById('countdown').className = 'countdown text-danger';
        }
    }
    
    updateCountdown();
    const countdownInterval = setInterval(updateCountdown, 1000);
    
    // ページが非表示になった時にインターバルを停止（パフォーマンス向上）
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            clearInterval(countdownInterval);
        } else {
            updateCountdown();
            // 新しいインターバルを開始
            setInterval(updateCountdown, 1000);
        }
    });
});

// LINE共有（外部ブラウザ強制対応）
function shareToLine() {
    const baseUrl = '{{ share_url }}';
    const externalUrl = getExternalBrowserUrlForShare(baseUrl);
    
    const text = encodeURIComponent('📍位置情報を共有しています\n以下のURLからアクセスしてください：');
    const url = encodeURIComponent(externalUrl);
    const lineUrl = `https://line.me/R/msg/text/?${text}%0A${url}`;
    
    // モバイルの場合はLINEアプリを直接開く
    if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        window.location.href = lineUrl;
    } else {
        window.open(lineUrl, '_blank');
    }
}

// メール共有（外部ブラウザ強制対応）
function shareToEmail() {
    const baseUrl = '{{ share_url }}';
    const externalUrl = getExternalBrowserUrlForShare(baseUrl);
    
    const subject = encodeURIComponent('📍位置情報共有のお知らせ');
    const body = encodeURIComponent(`位置情報を共有しています。

以下のURLからアクセスしてください：
${externalUrl}

📅 有効期限: {{ expires_at|date:"Y年m月d日 H:i" }}

⚠️ このリンクは自動的に期限切れになります。

※ LINEでリンクを開く場合、右上の「...」メニューから「他のアプリで開く」→「ブラウザで開く」を選択してください。`);
    
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}

// Web Share API または汎用共有（外部ブラウザ強制対応）
function shareGeneral() {
    const baseUrl = '{{ share_url }}';
    const externalUrl = getExternalBrowserUrlForShare(baseUrl);
    
    const shareData = {
        title: '位置情報共有',
        text: '位置情報を共有しています。以下のURLからアクセスしてください：',
        url: externalUrl
    };
    
    // Web Share APIが利用可能な場合
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        navigator.share(shareData)
            .then(() => console.log('共有成功'))
            .catch((error) => {
                console.log('共有キャンセル:', error);
                fallbackShare(externalUrl);
            });
    } else {
        fallbackShare(externalUrl);
    }
}

// 共有用の外部ブラウザ強制URLを生成
function getExternalBrowserUrlForShare(url) {
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'openExternalBrowser=1&utm_source=share&utm_medium=social';
}