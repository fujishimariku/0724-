const CACHE_NAME = 'location-share-v1';
const BACKGROUND_SYNC_TAG = 'background-location-sync';

// バックグラウンドでの位置情報共有対応
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'BACKGROUND_LOCATION_UPDATE') {
        // バックグラウンドでの位置情報更新処理
        handleBackgroundLocationUpdate(event.data.payload);
    }
});

// バックグラウンド同期
self.addEventListener('sync', event => {
    if (event.tag === BACKGROUND_SYNC_TAG) {
        event.waitUntil(syncLocationData());
    }
});

async function handleBackgroundLocationUpdate(data) {
    try {
        // WebSocket接続が利用できない場合のフォールバック
        const response = await fetch('/api/location/update/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': data.csrfToken
            },
            body: JSON.stringify({
                participant_id: data.participant_id,
                latitude: data.latitude,
                longitude: data.longitude,
                accuracy: data.accuracy,
                is_background: true
            })
        });
        
        if (!response.ok) {
            throw new Error('Background sync failed');
        }
    } catch (error) {
        console.error('Background location update failed:', error);
        // リトライのためにBackground Syncに登録
        self.registration.sync.register(BACKGROUND_SYNC_TAG);
    }
}

async function syncLocationData() {
    // IndexedDBから未送信のデータを取得して送信
    // 実装は必要に応じて
}

// プッシュ通知（参加者の参加・退出通知用）
self.addEventListener('push', event => {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: '/static/icon-192x192.png',
            badge: '/static/badge-72x72.png',
            tag: 'location-share'
        };
        
        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});