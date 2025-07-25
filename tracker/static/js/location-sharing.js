    // === 基本変数 ===
    let participantOrder = [];
    let lastAnimationTime = {};
    let websocket = null;
    let map;
    let markers = {};
    let accuracyCircles = {};
    let animationCircles = {};
    let watchId;
    let isSharing = false;
    let sessionExpired = false;
    let mapInitialized = false;
    let participantColors = {};
    let participantsData = [];
    let userInteracted = false;
    let autoFitEnabled = true;
    let lastKnownPosition = null;
    let isInBackground = false;
    let currentParticipantsHtml = '';
    let eventListeners = [];
    let markerUpdateQueue = new Map();
    let regularAnimationIntervals = {};
    let connectionInterval = null;
    let locationInterval = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let backgroundReconnectAttempts = 0;

    // === DOM要素キャッシュ ===
    let elements = {};

    // === 設定値の簡素化 ===
    const CONFIG = {
        CONNECTION_CHECK_INTERVAL: 15000,
        LOCATION_TIMEOUT: 10000,
        RECONNECT_BASE_DELAY: 2000,
        RECONNECT_MAX_DELAY: 30000,
        RECONNECT_MULTIPLIER: 1.5,
        PARTICIPANTS_UPDATE: 1000,
        MOVEMENT_THRESHOLD: 10,
        MIN_TIME_BETWEEN_UPDATES: 3000,
        MAX_TIME_WITHOUT_UPDATE: 45000,
        BACKGROUND_UPDATE_INTERVAL: 60000,
        POSITION_CACHE_DURATION: 300000,
    };

    // === 状態保存用の変数 ===
    let backgroundLocationUpdate = null;
    let lastSuccessfulConnection = null;
    let isReconnecting = false;
    let sessionState = {
        isSharing: false,
        participantName: '',
        lastPosition: null,
        sharingStartTime: null
    };
// === 通知重複防止用変数を追加 ===
let lastNotificationTime = {};
let lastWebSocketStatus = null;
let statusChangeTimeout = null;
    // === 追従対象管理用変数 ===
    let followingParticipantId = null;

    // === セッション情報 ===
    const sessionId = window.djangoData.sessionId;
    const participantId = window.djangoData.participantId;
    const expiresAt = new Date(window.djangoData.expiresAt); // Dateオブジェクトに変換
    
    console.log('sessionId:', sessionId, 'participantId:', participantId, 'expiresAt:', expiresAt);
    // === 移動検知用変数 ===
    let lastSentPosition = null;
    let lastSentTime = 0;
    let forcedUpdateTimeout = null;

    // === LocalStorage キー定数 ===
    const STORAGE_KEYS = {
        SESSION_STATE: `locationSharing_${sessionId}_${participantId}`,
        PARTICIPANT_NAME: `participantName_${sessionId}_${participantId}`,
        LAST_POSITION: `lastPosition_${sessionId}_${participantId}`
    };

    // === 状態管理の改善 ===
    function saveSessionState() {
        try {
            const stateToSave = {
                isSharing: isSharing,
                participantName: elements.participantName?.value || '',
                lastPosition: lastKnownPosition ? {
                    latitude: lastKnownPosition.coords.latitude,
                    longitude: lastKnownPosition.coords.longitude,
                    accuracy: lastKnownPosition.coords.accuracy,
                    timestamp: Date.now()
                } : null,
                sharingStartTime: sessionState.sharingStartTime,
                savedAt: Date.now()
            };
            
            localStorage.setItem(STORAGE_KEYS.SESSION_STATE, JSON.stringify(stateToSave));
            console.log('状態を保存しました:', stateToSave);
        } catch (error) {
            console.warn('状態保存に失敗:', error);
        }
    }

    function loadSessionState() {
        try {
            const savedState = localStorage.getItem(STORAGE_KEYS.SESSION_STATE);
            if (!savedState) return null;

            const state = JSON.parse(savedState);
            const timeSinceSaved = Date.now() - (state.savedAt || 0);
            
            // 5分以内の状態のみ復元
            //if (timeSinceSaved > CONFIG.POSITION_CACHE_DURATION) {
                //console.log('保存状態が古いため無視します');
                //clearSessionState();
                //return null;
            //}

            console.log('保存状態を読み込みました:', state);
            return state;
        } catch (error) {
            console.warn('状態読み込みに失敗:', error);
            clearSessionState();
            return null;
        }
    }

    function clearSessionState() {
        try {
            localStorage.removeItem(STORAGE_KEYS.SESSION_STATE);
            localStorage.removeItem(STORAGE_KEYS.PARTICIPANT_NAME);
            localStorage.removeItem(STORAGE_KEYS.LAST_POSITION);
        } catch (error) {
            console.warn('状態クリアに失敗:', error);
        }
    }

    // === イベントリスナー管理 ===
    function addEventListenerWithCleanup(element, event, handler, options = {}) {
        if (element) {
            element.addEventListener(event, handler, options);
            eventListeners.push({ element, event, handler, options });
        }
    }

    function cleanupEventListeners() {
        eventListeners.forEach(({ element, event, handler, options }) => {
            if (element && element.removeEventListener) {
                element.removeEventListener(event, handler, options);
            }
        });
        eventListeners = [];
    }

    // === DOM要素の初期化 ===
    function initElements() {
        elements = {
            wsStatus: document.getElementById('websocket-status'),
            locationStatus: document.getElementById('location-status'),
            visibilityStatus: document.getElementById('visibility-status'),
            participantsList: document.getElementById('participants-list'),
            countdown: document.getElementById('countdown'),
            participantName: document.getElementById('participant-name'),
            toggleSharing: document.getElementById('toggle-sharing'),
            sessionStatus: document.getElementById('session-status'),
            lastCommunication: document.getElementById('last-communication')
        };
    }

    // === 統合されたステータス更新 ===
    function updateStatus(type, status, message) {
    const element = elements[type + 'Status'];
    if (!element) return;

    switch (type) {
        case 'ws':
            // WebSocket状態変更の場合、短時間での変更を抑制
            if (statusChangeTimeout) {
                clearTimeout(statusChangeTimeout);
            }
            
            // 前回と同じ状態の場合は無視
            if (lastWebSocketStatus === status) {
                return;
            }
            
            statusChangeTimeout = setTimeout(() => {
                lastWebSocketStatus = status;
                
                let badgeClass = 'bg-secondary';
                let indicator = '';
                switch(status) {
                    case 'connected':
                        badgeClass = 'bg-success';
                        indicator = '<span class="connection-indicator connection-good"></span>';
                        break;
                    case 'reconnecting':
                        badgeClass = 'bg-warning';
                        indicator = '<span class="connection-indicator connection-poor"></span>';
                        break;
                    case 'error':
                    case 'disconnected':
                        badgeClass = 'bg-danger';
                        indicator = '<span class="connection-indicator connection-bad"></span>';
                        break;
                }
                element.innerHTML = `${indicator}<span class="badge ${badgeClass}">${message}</span>`;
                statusChangeTimeout = null;
            }, 1000); // 1秒の遅延で状態変更を確定
            break;
        case 'location':
        case 'visibility':
            element.textContent = message;
            element.className = `status-${status}`;
            break;
    }
}

    // === 通知表示の改良版（アイコン付き） ===
// === 通知表示の改良版（重複防止・スタック表示対応） ===
function showNotification(message, type = 'info', icon = null, preventDuplicates = true) {
    // 重複防止が有効で、同じメッセージが短時間内に送信された場合はスキップ
    if (preventDuplicates) {
        const now = Date.now();
        const lastTime = lastNotificationTime[message] || 0;
        if (now - lastTime < 5000) { // 5秒以内の同じメッセージは無視
            console.log('重複通知を防止:', message);
            return;
        }
        lastNotificationTime[message] = now;
    }
    
    const alertDiv = document.createElement('div');
    const iconHtml = icon ? `<i class="${icon} me-2"></i>` : '';
    alertDiv.className = `alert alert-${type} alert-dismissible fade show realtime-notification`;
    alertDiv.innerHTML = `
        ${iconHtml}${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // 既存の通知を下にずらす
    const existingNotifications = document.querySelectorAll('.realtime-notification');
    existingNotifications.forEach((notification, index) => {
        const currentTop = parseInt(notification.style.top) || 20;
        notification.style.top = (currentTop + 80) + 'px';
    });
    
    // 新しい通知を一番上に配置
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    alertDiv.style.maxWidth = '400px';
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
            // 通知削除後、残りの通知を上にずらす
            const remainingNotifications = document.querySelectorAll('.realtime-notification');
            remainingNotifications.forEach((notification) => {
                const currentTop = parseInt(notification.style.top) || 100;
                if (currentTop > 20) {
                    notification.style.top = (currentTop - 80) + 'px';
                }
            });
        }
    }, 5000);
}
// === 参加者状態追跡用変数（新規追加） ===
let previousParticipantsState = new Map(); // participant_id -> { name, status, is_sharing }
// === 通知をWebSocketで送信（新規追加） ===
function sendNotificationToAll(message, type, icon, excludeSelf = false) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const notificationData = {
            type: 'notification',
            participant_id: participantId,
            participant_name: elements.participantName?.value || '',
            message: message,
            notification_type: type,
            icon: icon,
            exclude_self: excludeSelf,
            timestamp: new Date().toISOString()
        };
        
        websocket.send(JSON.stringify(notificationData));
        console.log('通知を全参加者に送信:', message);
    }
    
    // 自分にも表示（excludeSelfがfalseの場合）
    if (!excludeSelf) {
        showNotification(message, type, icon);
    }
}
// === 参加者状態変化検知と通知（新規追加） ===
function detectAndNotifyStateChanges(newLocations) {
    const currentState = new Map();
    
    // 現在の状態を構築
    newLocations.forEach(location => {
        const hasValidLocation = location.latitude !== null && 
                               location.longitude !== null && 
                               location.latitude !== 999.0 && 
                               location.longitude !== 999.0 &&
                               !isNaN(location.latitude) && 
                               !isNaN(location.longitude);
        
        const isSharing = location.status === 'sharing' && hasValidLocation;
        
        currentState.set(location.participant_id, {
            name: location.participant_name || `参加者${location.participant_id.substring(0, 4)}`,
            status: location.status,
            is_sharing: isSharing,
            is_online: location.is_online
        });
    });
    
    // 新規参加者の検出（自分は除外）
    currentState.forEach((current, participant_id) => {
        if (participant_id === participantId) return;
        
        const previous = previousParticipantsState.get(participant_id);
        
        if (!previous) {
            // 新規参加者 - 重複防止付きで通知
            showNotification(
                `${current.name.substring(0, 30)}が参加しました`,
                'success',
                'fas fa-user-plus',
                true // 重複防止を有効化
            );
        } else {
            // 状態変化の検出 - 重複防止付きで通知
            if (!previous.is_sharing && current.is_sharing) {
                showNotification(
                    `${current.name.substring(0, 30)}が位置情報を共有しました`,
                    'info',
                    'fas fa-map-marker-alt',
                    true
                );
            } else if (previous.is_sharing && !current.is_sharing) {
                showNotification(
                    `${current.name.substring(0, 30)}が共有を停止しました`,
                    'warning',
                    'fas fa-pause',
                    true
                );
            }
            
            // オンライン・オフライン状態の変化を検出（重複防止強化）
            if (previous.is_online && !current.is_online) {
                showNotification(
                    `${current.name.substring(0, 30)}がオフラインになりました`,
                    'secondary',
                    'fas fa-wifi-slash',
                    true
                );
            } else if (!previous.is_online && current.is_online) {
                showNotification(
                    `${current.name.substring(0, 30)}がオンラインに復帰しました`,
                    'success',
                    'fas fa-wifi',
                    true
                );
            }
        }
    });
    
    // 退出者の検出 - 重複防止付きで通知
    previousParticipantsState.forEach((previous, participant_id) => {
        if (participant_id === participantId) return;
        
        if (!currentState.has(participant_id)) {
            showNotification(
                `${previous.name.substring(0, 30)}が退出しました`,
                'secondary',
                'fas fa-user-minus',
                true
            );
        }
    });
    
    // 状態を更新
    previousParticipantsState = new Map(currentState);
}
    // === 統合された接続管理 ===
    function startConnectionManagement() {
        if (connectionInterval) clearInterval(connectionInterval);
        
        connectionInterval = setInterval(() => {
            if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                if (!isReconnecting) {
                    console.warn('WebSocket接続が無効 - 再接続試行');
                    initWebSocket();
                }
                return;
            }

            const timeSinceLastSuccess = Date.now() - (lastSuccessfulConnection || 0);
            if (timeSinceLastSuccess > CONFIG.CONNECTION_CHECK_INTERVAL * 2) {
                console.warn('長時間通信なし - 接続確認');
            }

            const pingData = {
                type: 'ping',
                participant_id: participantId,
                timestamp: Date.now(),
                is_sharing: isSharing,
                has_position: !!lastKnownPosition
            };
            
            try {
                websocket.send(JSON.stringify(pingData));
                if (elements.lastCommunication) {
                    elements.lastCommunication.textContent = new Date().toLocaleTimeString() + ' (ping)';
                }
            } catch (error) {
                console.error('Ping送信エラー:', error);
                if (!isReconnecting) {
                    initWebSocket();
                }
            }
        }, CONFIG.CONNECTION_CHECK_INTERVAL);
    }

    function stopConnectionManagement() {
        if (connectionInterval) {
            clearInterval(connectionInterval);
            connectionInterval = null;
        }
    }

    // === WebSocket初期化（修正版） ===
    function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/location/${sessionId}/`;
    
    if (websocket) {
        websocket.onclose = null; // 既存の接続のイベントハンドラーを無効化
        websocket.close();
        websocket = null;
    }
    
    // 再接続中でない場合のみ状態を更新
    if (!isReconnecting) {
        isReconnecting = true;
        updateStatus('ws', 'reconnecting', '接続中...');
    }
    
    try {
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = function(event) {
            console.log('WebSocket接続確立');
            reconnectAttempts = 0;
            backgroundReconnectAttempts = 0;
            isReconnecting = false;
            lastSuccessfulConnection = Date.now();
            
            // 接続成功時のみステータス更新
            updateStatus('ws', 'connected', '接続中');
            startConnectionManagement();
            
            // 参加通知
            const joinMessage = {
                type: 'join',
                participant_id: participantId,
                participant_name: sessionState.participantName || elements.participantName?.value || '',
                is_sharing: isSharing,
                has_cached_position: !!lastKnownPosition,
                initial_status: isSharing ? 'sharing' : 'waiting'
            };
            websocket.send(JSON.stringify(joinMessage));
            
            // 位置共有中の場合のみ位置情報を送信
            if (isSharing && lastKnownPosition) {
                console.log('復帰時の位置情報を送信');
                sendLocationUpdate(lastKnownPosition);
            }
        };
        
        websocket.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
                lastSuccessfulConnection = Date.now();
            } catch (error) {
                console.error('メッセージ解析エラー:', error);
            }
        };
        
        websocket.onclose = function(event) {
            console.log('WebSocket接続切断:', event.code, event.reason);
            stopConnectionManagement();
            isReconnecting = false;
            
            // 即座に切断状態を表示せず、少し待ってから表示
            setTimeout(() => {
                if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                    updateStatus('ws', 'disconnected', '切断');
                }
            }, 2000);
            
            if (!sessionExpired) {
                const maxAttempts = isInBackground ? 5 : maxReconnectAttempts;
                const currentAttempts = isInBackground ? backgroundReconnectAttempts : reconnectAttempts;
                
                if (currentAttempts < maxAttempts) {
                    if (isInBackground) {
                        backgroundReconnectAttempts++;
                    } else {
                        reconnectAttempts++;
                    }
                    
                    const delay = Math.min(
                        CONFIG.RECONNECT_BASE_DELAY * Math.pow(CONFIG.RECONNECT_MULTIPLIER, currentAttempts),
                        CONFIG.RECONNECT_MAX_DELAY
                    );
                    
                    console.log(`再接続試行 ${currentAttempts + 1}/${maxAttempts} (${delay}ms後, background: ${isInBackground})`);
                    
                    // 再接続状態の表示も遅延
                    setTimeout(() => {
                        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                            updateStatus('ws', 'reconnecting', `再接続中 (${currentAttempts + 1}/${maxAttempts})`);
                        }
                    }, 1000);
                    
                    setTimeout(initWebSocket, delay);
                } else {
                    console.warn('最大再接続試行回数に達しました');
                    updateStatus('ws', 'error', 'エラー - 再試行上限');
                    
                    if (isInBackground) {
                        console.log('バックグラウンドでの再接続を停止。フォアグラウンド復帰時に再開します。');
                    }
                }
            }
        };
        
        websocket.onerror = function(error) {
            console.error('WebSocketエラー:', error);
            isReconnecting = false;
            // エラー状態の表示も遅延
            setTimeout(() => {
                if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                    updateStatus('ws', 'error', 'エラー');
                }
            }, 1000);
        };
        
    } catch (error) {
        console.error('WebSocket初期化エラー:', error);
        updateStatus('ws', 'error', 'エラー');
        isReconnecting = false;
    }
}

    // === メッセージハンドラーの修正（通知機能追加） ===
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'location_update':
            if (data.locations) {
                // 状態変化を検知して通知
                detectAndNotifyStateChanges(data.locations);
                
                // 既存の処理
                updateMapMarkers(data.locations);
                updateParticipantsList(data.locations);
                participantsData = data.locations;
            }
            break;
        case 'background_status_change':
            if (data.locations) {
                // 状態変化を検知して通知
                detectAndNotifyStateChanges(data.locations);
                
                // 既存の処理
                updateMapMarkers(data.locations);
                updateParticipantsList(data.locations);
                participantsData = data.locations;
                console.log(`参加者 ${data.participant_name || data.participant_id} のバックグラウンド状態が変更されました`);
            }
            break;
        case 'notification':
            // 他の参加者からの通知を受信
            if (data.exclude_self && data.participant_id === participantId) {
                // 自分が送信した通知で除外フラグがある場合はスキップ
                return;
            }
            showNotification(data.message, data.notification_type, data.icon);
            console.log('他の参加者からの通知を受信:', data.message);
            break;
        case 'session_expired':
            handleSessionExpired();
            break;
        case 'error':
            if (data.message.includes('期限切れ')) {
                handleSessionExpired();
            }
            break;
        case 'pong':
            // Ping応答を受信
            if (elements.lastCommunication) {
                elements.lastCommunication.textContent = new Date().toLocaleTimeString() + ' (pong)';
            }
            break;
    }
}

    // === 位置情報共有開始時の通知追加 ===
// === 位置情報共有開始時の通知削除版 ===
function startLocationSharing() {
    if (!navigator.geolocation) {
        updateStatus('location', 'error', 'このブラウザでは位置情報がサポートされていません');
        return;
    }

    // 状態を保存
    sessionState.isSharing = true;
    sessionState.sharingStartTime = Date.now();
    sessionState.participantName = elements.participantName?.value || '';

    // 移動検知用変数を初期化
    lastSentPosition = null;
    lastSentTime = 0;
    if (forcedUpdateTimeout) {
        clearTimeout(forcedUpdateTimeout);
        forcedUpdateTimeout = null;
    }

    updateStatus('location', 'waiting', '位置情報を取得中...');
    
    const options = {
        enableHighAccuracy: true,
        timeout: CONFIG.LOCATION_TIMEOUT,
        maximumAge: 2000
    };
    
    // 初回取得
    navigator.geolocation.getCurrentPosition(
        function(position) {
            lastKnownPosition = position;
            sessionState.lastPosition = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Date.now()
            };
            
            sendLocationUpdate(position);
            lastSentPosition = position;
            lastSentTime = Date.now();
            
            updateStatus('location', 'active', '位置情報を共有中');
            startLocationTracking();
            startBackgroundLocationUpdate();
            
            // 自分のマーカーに確実にフォーカス（共有開始時は必ずフォーカス）
            setTimeout(() => {
                if (mapInitialized && position) {
                    console.log('共有開始 - 自分の位置にフォーカス');
                    map.setView([position.coords.latitude, position.coords.longitude], Math.max(map.getZoom(), 15));
                    
                    // 共有開始時は追従状態も自分に設定
                    followingParticipantId = participantId;
                    updateFollowingStatus();
                }
            }, 500); // マーカー作成を待つ
            
            // 状態を保存
            saveSessionState();
        },
        function(error) {
            handleLocationError(error);
        },
        options
    );
    
    isSharing = true;
    updateSharingButton();
}

    function startBackgroundLocationUpdate() {
        if (backgroundLocationUpdate) {
            clearInterval(backgroundLocationUpdate);
        }
        
        backgroundLocationUpdate = setInterval(() => {
            if (isInBackground && isSharing && lastKnownPosition) {
                console.log('バックグラウンド位置更新');
                sendLocationUpdate(lastKnownPosition);
            }
        }, CONFIG.BACKGROUND_UPDATE_INTERVAL);
    }

    function stopBackgroundLocationUpdate() {
        if (backgroundLocationUpdate) {
            clearInterval(backgroundLocationUpdate);
            backgroundLocationUpdate = null;
        }
    }

    function startLocationTracking() {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }
        
        watchId = navigator.geolocation.watchPosition(
            function(position) {
                lastKnownPosition = position;
                updateStatus('location', 'active', '位置情報を共有中');
                
                // 状態を定期的に保存
                saveSessionState();
                
                if (shouldSendUpdate(position)) {
                    sendLocationUpdate(position);
                    lastSentPosition = position;
                    lastSentTime = Date.now();
                    
                    if (forcedUpdateTimeout) {
                        clearTimeout(forcedUpdateTimeout);
                        forcedUpdateTimeout = null;
                    }
                }
                
                if (!forcedUpdateTimeout) {
                    forcedUpdateTimeout = setTimeout(() => {
                        if (lastKnownPosition) {
                            sendLocationUpdate(lastKnownPosition);
                            lastSentPosition = lastKnownPosition;
                            lastSentTime = Date.now();
                        }
                        forcedUpdateTimeout = null;
                    }, CONFIG.MAX_TIME_WITHOUT_UPDATE);
                }
            },
            function(error) {
                console.warn('位置情報監視エラー:', error);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 1000
            }
        );
    }

    // === 共有停止時の通知削除版 ===
function stopLocationSharing() {
    console.log('位置情報共有を停止中...');
    
    // 監視を停止
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    if (locationInterval) {
        clearInterval(locationInterval);
        locationInterval = null;
    }
    
    stopBackgroundLocationUpdate();
    
    if (forcedUpdateTimeout) {
        clearTimeout(forcedUpdateTimeout);
        forcedUpdateTimeout = null;
    }
    
    // 移動検知用変数をリセット
    lastSentPosition = null;
    lastSentTime = 0;
    
    // 状態を更新
    sessionState.isSharing = false;
    sessionState.sharingStartTime = null;
    isSharing = false;
    
    // 自分のマーカーを即座に削除
    removeOwnMarker();
    
    // 共有停止通知を送信（待機状態に戻す）
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const stopSharingData = {
            type: 'stop_sharing',
            participant_id: participantId,
            participant_name: elements.participantName?.value || '',
            is_background: isInBackground,
            // 確実に位置情報をクリアするためのフラグ
            clear_location: true,
            timestamp: new Date().toISOString()
        };
        
        console.log('共有停止通知を送信 (background:', isInBackground, '):', stopSharingData);
        websocket.send(JSON.stringify(stopSharingData));
        
        // バックグラウンド状態の場合は追加で確認メッセージを送信
        if (isInBackground) {
            setTimeout(() => {
                if (websocket && websocket.readyState === WebSocket.OPEN && !isSharing) {
                    const confirmData = {
                        type: 'confirm_stop_sharing',
                        participant_id: participantId,
                        participant_name: elements.participantName?.value || '',
                        is_background: true,
                        timestamp: new Date().toISOString()
                    };
                    websocket.send(JSON.stringify(confirmData));
                    console.log('バックグラウンド共有停止確認を送信');
                }
            }, 1000);
        }
    }
    
    // UIを更新
    updateSharingButton();
    updateStatus('location', 'waiting', '待機中');
    
    // 状態を保存
    saveSessionState();
    
    console.log('位置情報共有を停止しました - 待機状態に変更 (background:', isInBackground, ')');
}

    // === 自分のマーカーを削除する関数 ===
    function removeOwnMarker() {
    console.log('自分のマーカーを削除中:', participantId, 'background:', isInBackground);
    
    // 定期アニメーションを停止
    stopRegularAnimation(participantId);
    
    // マーカーを削除
    if (markers[participantId]) {
        map.removeLayer(markers[participantId]);
        delete markers[participantId];
        console.log('マーカーを削除しました');
    }
    
    // 精度円を削除
    if (accuracyCircles[participantId]) {
        map.removeLayer(accuracyCircles[participantId]);
        delete accuracyCircles[participantId];
        console.log('精度円を削除しました');
    }
    
    // アニメーション円を削除
    if (animationCircles[participantId]) {
        map.removeLayer(animationCircles[participantId]);
        delete animationCircles[participantId];
        console.log('アニメーション円を削除しました');
    }
    
    // 参加者データからも位置情報を削除
    participantsData = participantsData.map(p => {
        if (p.participant_id === participantId) {
            return {
                ...p,
                latitude: null,
                longitude: null,
                accuracy: null,
                status: 'waiting',  // 待機状態に設定
                is_online: true     // オンライン状態は維持
            };
        }
        return p;
    });
    
    // 参加者リストを即座に更新
    updateParticipantsList(participantsData);
    
    console.log('自分のマーカー削除完了 - 待機状態に更新');
}

    // === 位置情報送信 ===
    function sendLocationUpdate(position) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        
        const normalizedAccuracy = validateAndNormalizeAccuracy(position.coords.accuracy);
        
        const locationData = {
            type: 'location_update',
            participant_id: participantId,
            participant_name: elements.participantName?.value || '',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: normalizedAccuracy,
            timestamp: new Date().toISOString(),
            is_background: isInBackground
        };
        
        if (position.coords.accuracy > 1000) {
            console.warn('異常な精度値を検出:', position.coords.accuracy, '→ 正常化:', normalizedAccuracy);
        }
        
        websocket.send(JSON.stringify(locationData));
    }

    function sendOfflineStatus() {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
        
        const offlineData = {
            type: 'offline',
            participant_id: participantId,
            participant_name: elements.participantName?.value || '',
            is_background: isInBackground
        };
        
        console.log('オフライン通知を送信:', offlineData);
        websocket.send(JSON.stringify(offlineData));
    }

    // === 位置情報エラーハンドリング ===
    function handleLocationError(error) {
        let message = '';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = '位置情報の利用が拒否されました';
                updateStatus('location', 'error', message);
                isSharing = false;
                updateSharingButton();
                break;
            case error.POSITION_UNAVAILABLE:
                message = '位置情報が取得できませんでした';
                updateStatus('location', 'error', message);
                break;
            case error.TIMEOUT:
                message = '位置情報の取得がタイムアウトしました';
                updateStatus('location', 'waiting', message + ' - 再試行中...');
                break;
        }
        console.warn('位置情報エラー:', message, error);
    }

    // === 参加者色管理 ===
    function getDeterministicColor(participantId) {
        let hash = 0;
        for (let i = 0; i < participantId.length; i++) {
            const char = participantId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#FFB6C1', '#20B2AA', '#FF69B4', '#32CD32',
            '#FF4500', '#8A2BE2', '#DC143C', '#00CED1', '#FFD700'
        ];
        
        return colors[Math.abs(hash) % colors.length];
    }

    function getParticipantColor(participantId) {
        if (!participantColors[participantId]) {
            participantColors[participantId] = getDeterministicColor(participantId);
        }
        return participantColors[participantId];
    }

    function getInitials(name) {
        if (!name) return 'UN';
        const limitedName = name.substring(0, 30);
        return limitedName.substring(0, 2).toUpperCase();
    }

    // === マップ管理（修正版） ===
    function initMap() {
        map = L.map('map').setView([35.6762, 139.6503], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        // ドラッグ操作でのみ追従解除（ズームは除外）
        map.on('dragstart', function() {
            userInteracted = true;
            autoFitEnabled = false;
            followingParticipantId = null;
            console.log('ドラッグ操作により追従を解除しました');
        });

        // ズーム操作では追従は解除しない（autoFitのみ無効化）
        map.on('zoomstart', function() {
            userInteracted = true;
            autoFitEnabled = false;
            console.log('ズーム操作 - 追従は継続、自動調整のみ無効化');
        });

        // マップクリック時の追従解除（マーカー以外をクリックした場合）
        map.on('click', function(e) {
            if (!e.originalEvent.target.closest('.custom-marker')) {
                followingParticipantId = null;
                console.log('マップクリックにより追従を解除しました');
            }
        });
        
        mapInitialized = true;
    }

    function createCustomMarker(name, color) {
        const initials = getInitials(name);
        const markerHtml = `
            <div class="custom-marker" style="background-color: ${color};">
                ${initials}
            </div>
        `;
        
        return L.divIcon({
            html: markerHtml,
            className: 'custom-div-icon',
            iconSize: [40, 40],
            iconAnchor: [20, 45],
            popupAnchor: [0, -40]
        });
    }

    // === マップマーカー更新の修正版 ===
function updateMapMarkers(locations) {
    if (!mapInitialized) return;
    
    const currentMarkerIds = new Set(Object.keys(markers));
    
    // 位置情報が有効な参加者のみをフィルタリング（より厳密な判定）
    const validLocations = locations.filter(loc => {
        const hasValidCoords = loc.latitude !== null && 
                              loc.longitude !== null && 
                              loc.latitude !== 999.0 && 
                              loc.longitude !== 999.0 &&
                              !isNaN(loc.latitude) && 
                              !isNaN(loc.longitude);
        
        // ステータスも考慮
        const isSharing = loc.status === 'sharing';
        
        return hasValidCoords && isSharing;
    });
    
    const newLocationIds = new Set(validLocations.map(loc => loc.participant_id));
    
    // 削除対象：現在のマーカーのうち、有効な位置情報リストに含まれないもの
    const markersToRemove = [...currentMarkerIds].filter(id => !newLocationIds.has(id));
    
    markersToRemove.forEach(id => {
        console.log(`マーカーを削除中: ${id} (共有停止または無効な位置情報)`);
        stopRegularAnimation(id);
        
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
        
        if (accuracyCircles[id]) {
            map.removeLayer(accuracyCircles[id]);
            delete accuracyCircles[id];
        }
        
        if (animationCircles[id]) {
            map.removeLayer(animationCircles[id]);
            delete animationCircles[id];
        }
    });
    
    // 有効な位置情報のみをキューに追加
    validLocations.forEach(location => {
        markerUpdateQueue.set(location.participant_id, location);
    });
    
    requestAnimationFrame(() => {
        processBatchMarkerUpdates();
        markerUpdateQueue.clear();
    });
}

    // === バッチマーカー更新処理 ===
    // === バッチマーカー更新処理（重なり対応版） ===
    function processBatchMarkerUpdates() {
        const locations = Array.from(markerUpdateQueue.values());
        
        // 重なりグループを検出
        const overlapGroups = adjustOverlappingMarkers(locations);
        
        overlapGroups.forEach(group => {
            if (group.length === 1) {
                // 単独マーカーの処理（従来通り）
                updateSingleMarker(group[0], 1, 0);
            } else {
                // 重なりマーカーの処理
                updateOverlappingMarkers(group);
            }
        });
        
        // 自動調整（追従中でない場合のみ）
        if (!userInteracted && autoFitEnabled && !followingParticipantId && locations.length > 0) {
            if (locations.length === 1) {
                const loc = locations[0];
                map.setView([loc.latitude, loc.longitude], 15);
            } else {
                const group = new L.featureGroup(Object.values(markers));
                const bounds = group.getBounds();
                if (bounds.isValid()) {
                    map.fitBounds(bounds.pad(0.1));
                }
            }
        }
    }

    // === 重なりマーカー更新 ===
    function updateOverlappingMarkers(group) {
        const centerLat = group.reduce((sum, loc) => sum + loc.latitude, 0) / group.length;
        const centerLng = group.reduce((sum, loc) => sum + loc.longitude, 0) / group.length;
        
        // 円形に配置するための角度計算
        const angleStep = (2 * Math.PI) / group.length;
        const offsetPixels = 25; // ピクセル単位でのオフセット
        
        group.forEach((location, index) => {
            // 円形配置の座標計算
            const angle = index * angleStep;
            const offsetLat = (Math.cos(angle) * offsetPixels) / 111000; // 緯度1度≈111km
            const offsetLng = (Math.sin(angle) * offsetPixels) / (111000 * Math.cos(centerLat * Math.PI / 180));
            
            const adjustedLat = centerLat + offsetLat;
            const adjustedLng = centerLng + offsetLng;
            
            // マーカーを調整された位置に配置
            const originalName = location.participant_name || `参加者${location.participant_id.substring(0, 4)}`;
            const name = originalName.substring(0, 30);
            const color = getParticipantColor(location.participant_id);
            
            if (markers[location.participant_id]) {
                const marker = markers[location.participant_id];
                marker.setLatLng([adjustedLat, adjustedLng]);
                marker.setIcon(createCustomMarkerWithOverlap(name, color, group.length, index));
                
                // 追従中の場合は元の位置（調整前）に移動
                if (followingParticipantId === location.participant_id) {
                    map.setView([location.latitude, location.longitude], map.getZoom());
                }
            } else {
                const customIcon = createCustomMarkerWithOverlap(name, color, group.length, index);
                const marker = L.marker([adjustedLat, adjustedLng], {
                    icon: customIcon
                })
                .addTo(map)
                .bindPopup(`
                    <div style="color: ${color}; font-weight: bold;">${name}</div>
                    <div>最終更新: ${new Date(location.last_updated).toLocaleTimeString()}</div>
                    <div><small>近接グループ: ${group.length}人</small></div>
                `);
                
                // マーカークリック時は元の位置に移動
                marker.on('click', function() {
                    followingParticipantId = location.participant_id;
                    map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 15));
                    console.log(`重なりグループの参加者 ${location.participant_id} の追従を開始`);
                });
                
                markers[location.participant_id] = marker;
            }
            
            // 精度円は調整された位置に表示（マーカーと同じ位置）
            updateAccuracyCircle(location.participant_id, adjustedLat, adjustedLng, location.accuracy, color);

            // アニメーションも調整された位置で実行（マーカーと同じ位置）
            createRippleAnimation(location.participant_id, adjustedLat, adjustedLng, color, location.accuracy);
            startRegularAnimation(location.participant_id, location.latitude, location.longitude, color, location.accuracy);
        });
    }
// === 単独マーカー更新 ===
    function updateSingleMarker(location, groupSize, indexInGroup) {
        const originalName = location.participant_name || `参加者${location.participant_id.substring(0, 4)}`;
        const name = originalName.substring(0, 30);
        const color = getParticipantColor(location.participant_id);
        
        let accuracyText;
        if (!location.accuracy || location.accuracy <= 0) {
            accuracyText = '不明';
        } else if (location.accuracy > 1000) {
            accuracyText = '低精度';
        } else {
            accuracyText = `${Math.round(location.accuracy)}m`;
        }
        
        if (markers[location.participant_id]) {
            const marker = markers[location.participant_id];
            marker.setLatLng([location.latitude, location.longitude]);
            marker.setIcon(createCustomMarkerWithOverlap(name, color, groupSize, indexInGroup));
            marker.setPopupContent(`
                <div style="color: ${color}; font-weight: bold;">${name}</div>
                <div>最終更新: ${new Date(location.last_updated).toLocaleTimeString()}</div>
                <div>精度: ${accuracyText}</div>
                ${groupSize > 1 ? `<div><small>近接グループ: ${groupSize}人</small></div>` : ''}
            `);
            
            // 追従中の場合は現在の位置に移動
            if (followingParticipantId === location.participant_id) {
                map.setView([location.latitude, location.longitude], map.getZoom());
            }
        } else {
            const customIcon = createCustomMarkerWithOverlap(name, color, groupSize, indexInGroup);
            const marker = L.marker([location.latitude, location.longitude], {
                icon: customIcon
            })
            .addTo(map)
            .bindPopup(`
                <div style="color: ${color}; font-weight: bold;">${name}</div>
                <div>最終更新: ${new Date(location.last_updated).toLocaleTimeString()}</div>
                <div>精度: ${accuracyText}</div>
                ${groupSize > 1 ? `<div><small>近接グループ: ${groupSize}人</small></div>` : ''}
            `);
            
            // マーカークリック時の追従開始
            marker.on('click', function() {
                followingParticipantId = location.participant_id;
                const currentLatLng = marker.getLatLng();
                map.setView([currentLatLng.lat, currentLatLng.lng], Math.max(map.getZoom(), 15));
                console.log(`参加者 ${location.participant_id} の追従を開始`);
            });
            
            markers[location.participant_id] = marker;
        }
        
        // 精度円の更新
        updateAccuracyCircle(location.participant_id, location.latitude, location.longitude, location.accuracy, color);
        
        // アニメーションを実行
        createRippleAnimation(location.participant_id, location.latitude, location.longitude, color, location.accuracy);
        
        // 定期アニメーションを開始
        startRegularAnimation(location.participant_id, location.latitude, location.longitude, color, location.accuracy);
    }
    function updateAccuracyCircle(participantId, latitude, longitude, accuracy, color) {
        // 異常な精度値または無効な値の場合は精度円を表示しない
        if (!accuracy || accuracy <= 0 || accuracy > 1000) {
            if (accuracyCircles[participantId]) {
                map.removeLayer(accuracyCircles[participantId]);
                delete accuracyCircles[participantId];
            }
            return;
        }

        const position = [latitude, longitude];
        
        if (accuracyCircles[participantId]) {
            accuracyCircles[participantId].setLatLng(position);
            accuracyCircles[participantId].setRadius(accuracy);
        } else {
            accuracyCircles[participantId] = L.circle(position, {
                radius: accuracy,
                color: color,
                fillColor: color,
                fillOpacity: 0.1,
                opacity: 0.3,
                weight: 2
            }).addTo(map);
        }
    }

    function createRippleAnimation(participantId, latitude, longitude, color, accuracy) {
        const now = Date.now();
        
        // 既存のアニメーション円があれば削除
        if (animationCircles[participantId]) {
            map.removeLayer(animationCircles[participantId]);
            delete animationCircles[participantId];
        }
        
        // 精度に基づいて最終半径を決定（異常値の場合はデフォルト値使用）
        let maxRadius;
        if (!accuracy || accuracy <= 0 || accuracy > 1000) {
            maxRadius = 50; // デフォルト値
        } else {
            maxRadius = accuracy;
        }
        
        // 新しいアニメーション円を作成
        const animationCircle = L.circle([latitude, longitude], {
            radius: 8,
            color: color,
            fillColor: color,
            fillOpacity: 0.3,
            opacity: 0.8,
            weight: 3
        }).addTo(map);
        
        animationCircles[participantId] = animationCircle;
        
        const duration = 1500;
        const startTime = Date.now();
        const initialRadius = 8;
        
        function animate() {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1) {
                animationCircle.setRadius(maxRadius);
                animationCircle.setStyle({
                    opacity: 0.2,
                    fillOpacity: 0.05,
                    weight: 2
                });
                return;
            }
            
            const easeOut = 1 - Math.pow(1 - progress, 3);
            const currentRadius = initialRadius + (maxRadius - initialRadius) * easeOut;
            const currentOpacity = 0.8 * (1 - progress * 0.75);
            const currentFillOpacity = 0.3 * (1 - progress * 0.83);
            
            animationCircle.setRadius(currentRadius);
            animationCircle.setStyle({
                opacity: currentOpacity,
                fillOpacity: currentFillOpacity,
                weight: Math.max(2, 3 * (1 - progress * 0.33))
            });
            
            requestAnimationFrame(animate);
        }
        
        requestAnimationFrame(animate);
    }

    // === 定期アニメーション開始関数（修正版） ===
    function startRegularAnimation(participantId, latitude, longitude, color, accuracy) {
        // 既存の定期アニメーションがあれば停止
        if (regularAnimationIntervals[participantId]) {
            clearInterval(regularAnimationIntervals[participantId]);
        }
        
        // 3秒間隔で定期的にアニメーション実行
        regularAnimationIntervals[participantId] = setInterval(() => {
            if (markers[participantId]) { // マーカーが存在する場合のみ
                // マーカーの現在位置を取得してアニメーション実行
                const currentLatLng = markers[participantId].getLatLng();
                createRippleAnimation(participantId, currentLatLng.lat, currentLatLng.lng, color, accuracy);
            }
        }, 3000);
    }

    // === 定期アニメーション停止関数 ===
    function stopRegularAnimation(participantId) {
        if (regularAnimationIntervals[participantId]) {
            clearInterval(regularAnimationIntervals[participantId]);
            delete regularAnimationIntervals[participantId];
        }
    }

    // === 参加者リスト管理 ===
    function updateParticipantsList(locations) {
    if (!elements.participantsList) return;
    
    if (locations.length === 0) {
        const emptyHtml = '<div class="text-center text-muted">参加者がいません</div>';
        if (currentParticipantsHtml !== emptyHtml) {
            elements.participantsList.innerHTML = emptyHtml;
            currentParticipantsHtml = emptyHtml;
        }
        return;
    }
    
    // 新規参加者を順序リストに追加
    locations.forEach(location => {
        if (!participantOrder.includes(location.participant_id)) {
            participantOrder.push(location.participant_id);
        }
    });
    
    // 退出した参加者を順序リストから削除
    participantOrder = participantOrder.filter(id => 
        locations.some(location => location.participant_id === id)
    );
    
    participantsData = locations;
    updateParticipantsDisplay();
}
    // === 参加者リスト表示の修正版（追従状態表示付き） ===
    function updateParticipantsDisplay() {
    if (!elements.participantsList || participantsData.length === 0) return;
    
    let html = '';
    
    const sortedLocations = participantOrder.map(id => 
        participantsData.find(location => location.participant_id === id)
    ).filter(location => location !== undefined);
    
    sortedLocations.forEach(location => {
        const isMe = location.participant_id === participantId;
        const isFollowing = followingParticipantId === location.participant_id;
        const lastUpdated = new Date(location.last_updated);
        const timeDiff = Math.floor((new Date() - lastUpdated) / 1000);
        
        // 追従表示の条件：オンラインで位置情報を共有中の場合のみ
        const canShowFollowing = isFollowing && 
                               location.is_online && 
                               location.status === 'sharing' &&
                               location.latitude !== null && 
                               location.longitude !== null;
        
        let statusClass = '';
        let statusText = '';
        
        // 位置情報が有効かどうかの判定
        const hasValidLocation = location.latitude !== null && 
                               location.longitude !== null && 
                               location.latitude !== 999.0 && 
                               location.longitude !== 999.0 &&
                               !isNaN(location.latitude) && 
                               !isNaN(location.longitude);
        
        // ステータス判定ロジック（バックグラウンド状態を考慮）
        if (location.status === 'waiting' && location.is_online) {
            statusClass = 'status-waiting';
            statusText = isMe ? '共有待機中' : '参加中（未共有）';
        } else if (location.status === 'stopped' || !location.is_online) {
            statusClass = 'status-offline';
            if (timeDiff > 300) {
                statusText = isMe ? 'オフライン（通信エラー）' : 'オフライン（通信エラー）';
            } else {
                statusText = isMe ? 'オフライン' : 'オフライン';
            }
        } else if (location.status === 'sharing' && hasValidLocation) {
            if (location.is_background) {
                statusClass = 'status-background';
                statusText = 'バックグラウンド';
            } else if (timeDiff < 120) {
                statusClass = 'status-online';
                statusText = 'オンライン';
            } else if (timeDiff < 300) {
                statusClass = 'status-background';
                statusText = '一時的にオフライン';
            } else {
                statusClass = 'status-offline';
                statusText = 'オフライン（通信エラー）';
            }
        } else {
            statusClass = 'status-waiting';
            statusText = isMe ? '状態確認中' : '状態不明';
        }
        
        const color = getParticipantColor(location.participant_id);
        const originalName = location.participant_name || `参加者${location.participant_id.substring(0, 4)}`;
        const name = originalName.substring(0, 30);
        
        let accuracyText;
        if (location.status === 'waiting') {
            accuracyText = isMe ? '位置共有を開始してください' : '位置共有待ち';
        } else if (!hasValidLocation || location.status === 'stopped') {
            accuracyText = '位置情報なし';
        } else if (!location.accuracy || location.accuracy <= 0) {
            accuracyText = '精度: 不明';
        } else if (location.accuracy > 1000) {
            accuracyText = '精度: 低精度';
        } else {
            accuracyText = `精度: ${Math.round(location.accuracy)}m`;
        }
        
        html += `
            <div class="participant-item ${canShowFollowing ? 'following-participant' : ''}">
                <div class="status-dot ${statusClass}"></div>
                <div class="flex-grow-1">
                    <strong style="color: ${color};">${name}</strong>
                    ${isMe ? '<span class="badge bg-primary ms-1">自分</span>' : ''}
                    ${canShowFollowing ? '<span class="badge bg-info ms-1"><i class="fas fa-crosshairs"></i> 追従中</span>' : ''}
                    <br>
                    <small class="text-muted">
                        ${statusText}
                        <br>
                        ${accuracyText}
                        ${isMe && isInBackground ? ' <span class="badge bg-secondary">BG</span>' : ''}
                    </small>
                </div>
            </div>
        `;
    });
    
    if (currentParticipantsHtml !== html) {
        elements.participantsList.innerHTML = html;
        currentParticipantsHtml = html;
    }
    
    // 追従状態表示も更新
    updateFollowingStatus();
}

    // === UI制御（追従状態表示の追加） ===
    function updateSharingButton() {
        if (!elements.toggleSharing) return;
        
        if (isSharing) {
            elements.toggleSharing.innerHTML = '<i class="fas fa-pause"></i> 共有停止';
            elements.toggleSharing.className = 'btn btn-warning';
        } else {
            elements.toggleSharing.innerHTML = '<i class="fas fa-play"></i> 共有開始';
            elements.toggleSharing.className = 'btn btn-success';
        }
        
        // 追従状態の表示更新
        updateFollowingStatus();
    }
// === 追従状態表示の新規追加 ===
    function updateFollowingStatus() {
    const followingStatus = document.getElementById('following-status');
    if (followingStatus) {
        if (followingParticipantId) {
            const participant = participantsData.find(p => p.participant_id === followingParticipantId);
            
            // 参加者がオンラインで有効な位置情報を持っている場合のみ追従表示
            if (participant && participant.is_online && 
                participant.status === 'sharing' &&
                participant.latitude !== null && participant.longitude !== null) {
                
                const name = participant.participant_name || `参加者${followingParticipantId.substring(0, 4)}`;
                followingStatus.innerHTML = `<span class="badge bg-info"><i class="fas fa-crosshairs"></i> ${name}を追従中</span>`;
            } else {
                // 参加者がオフラインまたは位置情報を共有していない場合は追従を解除
                if (participant && (!participant.is_online || participant.status !== 'sharing')) {
                    console.log('追従対象がオフラインまたは非共有のため追従を解除:', followingParticipantId);
                    followingParticipantId = null;
                }
                followingStatus.innerHTML = '';
            }
        } else {
            followingStatus.innerHTML = '';
        }
    }
}

    // === リセット機能の修正 ===
    function resetAutoFit() {
        userInteracted = false;
        autoFitEnabled = true;
        followingParticipantId = null; // 追従も解除
        
        console.log('マップビューをリセット - 追従解除');
        updateFollowingStatus(); // 追従状態表示を更新
        
        const allLayers = [...Object.values(markers), ...Object.values(accuracyCircles)];
        
        if (allLayers.length > 0) {
            if (Object.keys(markers).length === 1) {
                const marker = Object.values(markers)[0];
                const latLng = marker.getLatLng();
                map.setView([latLng.lat, latLng.lng], 15);
            } else {
                const group = new L.featureGroup(allLayers);
                const bounds = group.getBounds();
                if (bounds.isValid()) {
                    map.fitBounds(bounds.pad(0.1));
                }
            }
        }
    }

    function updateCountdown() {
        if (!elements.countdown) return;
        
        const now = new Date();
        const timeLeft = expiresAt - now;
        
        if (timeLeft <= 0) {
            elements.countdown.textContent = '期限切れ';
            handleSessionExpired();
            return;
        }
        
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        elements.countdown.textContent = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // === セッション管理 ===
    function handleSessionExpired() {
        sessionExpired = true;
        stopLocationSharing();
        clearSessionState(); // 期限切れ時は状態をクリア
        
        if (elements.sessionStatus) {
            elements.sessionStatus.innerHTML = '<span class="badge bg-danger">期限切れ</span>';
        }
        
        updateStatus('location', 'error', 'セッションが期限切れです');
        
        const modal = new bootstrap.Modal(document.getElementById('session-expired-modal'));
        modal.show();
    }

    function leaveSession() {
        if (confirm('セッションから退出しますか？')) {
            if (websocket && websocket.readyState === WebSocket.OPEN) {
                const leaveData = {
                    type: 'leave',
                    participant_id: participantId
                };
                websocket.send(JSON.stringify(leaveData));
            }
            
            stopLocationSharing();
            clearSessionState(); // 退出時は状態をクリア
            
            if (websocket) {
                websocket.close();
            }
            
            window.location.href = '/';
        }
    }

    // === 状態復元の改善版 ===
    function restoreSessionState() {
        console.log('セッション状態を復元中...');
        
        const savedState = loadSessionState();
        if (!savedState) {
            console.log('復元する状態がありません');
            return;
        }
        
        // 名前の復元
        if (savedState.participantName && elements.participantName) {
            elements.participantName.value = savedState.participantName;
            sessionState.participantName = savedState.participantName;
            console.log('参加者名を復元:', savedState.participantName);
        }
        
        // 位置情報の復元
        if (savedState.lastPosition) {
            // 模擬的なPositionオブジェクトを作成
            lastKnownPosition = {
                coords: {
                    latitude: savedState.lastPosition.latitude,
                    longitude: savedState.lastPosition.longitude,
                    accuracy: savedState.lastPosition.accuracy
                },
                timestamp: savedState.lastPosition.timestamp
            };
            sessionState.lastPosition = savedState.lastPosition;
            console.log('最後の位置情報を復元:', savedState.lastPosition);
        }
        
        // 共有状態の復元
        if (savedState.isSharing) {
            const timeSinceSharing = Date.now() - (savedState.sharingStartTime || 0);
            if (timeSinceSharing < CONFIG.POSITION_CACHE_DURATION) {
                console.log('位置共有状態を復元中...');
                sessionState.isSharing = true;
                sessionState.sharingStartTime = savedState.sharingStartTime;
                
                // WebSocket接続後に共有を自動開始
                setTimeout(() => {
                    if (!isSharing && !sessionExpired) {
                        console.log('自動的に位置共有を再開');
                        showNotification('前回の共有状態を復元しました', 'info');
                        startLocationSharing();
                    }
                }, 3000); // WebSocket接続完了を待つ
            } else {
                console.log('共有状態が古いため復元しません');
                clearSessionState();
            }
        }
    }

    // === 初期化（修正版） ===
    document.addEventListener('DOMContentLoaded', function() {
    console.log('アプリケーション初期化開始');
    
    initElements();
    initMap();
    
    // 状態復元を実行
    restoreSessionState();
    
    // WebSocket接続を少し遅らせて安定化
    setTimeout(initWebSocket, 1000);
    
    // イベントリスナー設定
    if (elements.toggleSharing) {
        addEventListenerWithCleanup(elements.toggleSharing, 'click', function() {
            if (isSharing) {
                stopLocationSharing();
            } else {
                const modal = new bootstrap.Modal(document.getElementById('permission-modal'));
                modal.show();
            }
        });
    }
    
    const resetViewBtn = document.getElementById('reset-view');
    if (resetViewBtn) {
        addEventListenerWithCleanup(resetViewBtn, 'click', resetAutoFit);
    }
    
    const leaveSessionBtn = document.getElementById('leave-session');
    if (leaveSessionBtn) {
        addEventListenerWithCleanup(leaveSessionBtn, 'click', leaveSession);
    }
    
    // 権限要求ボタンの適切な処理
    const requestLocationBtn = document.getElementById('request-location');
    if (requestLocationBtn) {
        addEventListenerWithCleanup(requestLocationBtn, 'click', function() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('permission-modal'));
            if (modal) {
                modal.hide();
            }
            startLocationSharing();
        });
    }
    
    // onclick属性のあるボタンの修正
    const requestLocationButtons = document.querySelectorAll('[onclick*="requestLocation"]');
    requestLocationButtons.forEach(button => {
        button.removeAttribute('onclick');
        addEventListenerWithCleanup(button, 'click', function() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('permission-modal'));
            if (modal) {
                modal.hide();
            }
            startLocationSharing();
        });
    });
    
    // 名前変更監視をセットアップ
    setupNameChangeListener();
    
    // ページ可視性変更ハンドラーをセットアップ
    setupVisibilityChangeHandler();
    
    // 定期処理
    setInterval(updateCountdown, 1000);
    setInterval(updateParticipantsDisplay, CONFIG.PARTICIPANTS_UPDATE);
    
    // 定期的な状態保存
    setInterval(() => {
        if (isSharing) {
            saveSessionState();
        }
    }, 30000); // 30秒間隔
    
    updateCountdown();
    updateStatus('visibility', 'active', 'アクティブ');
    
    console.log('アプリケーション初期化完了 - 即時反映システム有効');
});

    // === クリーンアップ（修正版） ===
    window.addEventListener('beforeunload', function(e) {
    console.log('ページ離脱前の処理');
    
    // 現在の状態を保存
    if (isSharing) {
        saveSessionState();
        sendOfflineStatus(); // 全参加者に即座に反映
    }
    
    // 全てのリソースをクリーンアップ
    stopConnectionManagement();
    stopBackgroundLocationUpdate();
    
    if (locationInterval) clearInterval(locationInterval);
    
    // 全ての定期アニメーションを停止
    Object.keys(regularAnimationIntervals).forEach(id => {
        stopRegularAnimation(id);
    });
    
    // イベントリスナーのクリーンアップ
    cleanupEventListeners();
    
    // マーカーとサークルのクリーンアップ
    if (mapInitialized) {
        Object.values(markers).forEach(marker => map.removeLayer(marker));
        Object.values(accuracyCircles).forEach(circle => map.removeLayer(circle));
        Object.values(animationCircles).forEach(circle => map.removeLayer(circle));
    }
    
    if (websocket) {
        websocket.close();
    }
});

    // === ページ可視性管理の修正版 ===
function setupVisibilityChangeHandler() {
    document.addEventListener('visibilitychange', function() {
        const wasInBackground = isInBackground;
        isInBackground = document.hidden;
        
        console.log(`可視性変更: ${wasInBackground ? 'BG' : 'FG'} → ${isInBackground ? 'BG' : 'FG'}, 共有中: ${isSharing}`);
        
        if (!isInBackground && wasInBackground) {
            console.log('フォアグラウンドに復帰 - 接続状態を確認中');
            updateStatus('visibility', 'active', 'アクティブ');
            
            // 再接続試行回数をリセット
            backgroundReconnectAttempts = 0;
            
            // WebSocket接続チェック
            if (!websocket || websocket.readyState !== WebSocket.OPEN) {
                console.log('フォアグラウンド復帰時にWebSocket再接続');
                setTimeout(initWebSocket, 1000);
            } else {
                // 状態同期確認（特に共有停止状態の場合）
                if (!isSharing) {
                    console.log('フォアグラウンド復帰時の共有停止状態確認');
                    setTimeout(() => {
                        if (websocket && websocket.readyState === WebSocket.OPEN && !isSharing) {
                            const syncData = {
                                type: 'sync_status',
                                participant_id: participantId,
                                participant_name: elements.participantName?.value || '',
                                is_sharing: false,
                                status: 'waiting',
                                is_background: false
                            };
                            websocket.send(JSON.stringify(syncData));
                            console.log('共有停止状態の同期確認を送信');
                        }
                    }, 1000);
                }
            }
            
        } else if (isInBackground && !wasInBackground) {
            console.log('バックグラウンドに移行');
            updateStatus('visibility', 'background', 'バックグラウンド');
        }
        
        // WebSocketが接続中の場合は可視性変更を通知
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            const statusData = {
                type: 'background_status_update',
                participant_id: participantId,
                participant_name: elements.participantName?.value || '',
                is_background: isInBackground,
                has_position: !!lastKnownPosition,
                is_sharing: isSharing,
                timestamp: new Date().toISOString()
            };
            
            try {
                websocket.send(JSON.stringify(statusData));
                console.log(`バックグラウンド状態変更を送信: ${isInBackground ? 'BG' : 'FG'}, 共有: ${isSharing}`);
            } catch (error) {
                console.warn('バックグラウンド状態変更通知の送信に失敗:', error);
            }
        }
    });
}
    // === 名前変更リスナーの修正版 ===
function setupNameChangeListener() {
    if (elements.participantName) {
        let nameUpdateTimeout;
        addEventListenerWithCleanup(elements.participantName, 'input', function() {
            let newName = this.value.trim();
            if (newName.length > 30) {
                newName = newName.substring(0, 30);
                this.value = newName;
            }
            
            // 自分のマーカー即座更新
            if (markers[participantId]) {
                const color = getParticipantColor(participantId);
                const customIcon = createCustomMarker(newName || `参加者${participantId.substring(0, 4)}`, color);
                markers[participantId].setIcon(customIcon);
            }
            
            // 状態を保存
            sessionState.participantName = newName;
            saveSessionState();
            
            // デバウンス処理でWebSocket送信頻度を制限
            clearTimeout(nameUpdateTimeout);
            nameUpdateTimeout = setTimeout(() => {
                if (websocket && websocket.readyState === WebSocket.OPEN) {
                    const nameUpdateData = {
                        type: 'name_update',
                        participant_id: participantId,
                        participant_name: newName
                    };
                    websocket.send(JSON.stringify(nameUpdateData));
                    console.log('名前変更を送信 - 全参加者に即座に反映されます');
                }
            }, 500);
        });
    }
}
    // === ユーティリティ関数 ===
    function requestLocation() {
        const modal = bootstrap.Modal.getInstance(document.getElementById('permission-modal'));
        if (modal) {
            modal.hide();
        }
        startLocationSharing();
    }
    
    function goToHome() {
        window.location.href = '/';
    }

    // === 精度値の検証と正常化 ===
    function validateAndNormalizeAccuracy(accuracy) {
        if (!accuracy || accuracy <= 0 || accuracy > 1000) {
            return null;
        }
        return Math.round(accuracy);
    }

    // === 位置情報の品質チェック ===
    function assessLocationQuality(position) {
        const accuracy = position.coords.accuracy;
        
        if (!accuracy || accuracy <= 0) {
            return { quality: 'unknown', message: '精度情報なし' };
        } else if (accuracy <= 5) {
            return { quality: 'excellent', message: '非常に高精度' };
        } else if (accuracy <= 20) {
            return { quality: 'good', message: '高精度' };
        } else if (accuracy <= 100) {
            return { quality: 'fair', message: '中程度の精度' };
        } else if (accuracy <= 1000) {
            return { quality: 'poor', message: '低精度' };
        } else {
            return { quality: 'very_poor', message: '極めて低い精度' };
        }
    }

    // === 距離計算 ===
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // 地球の半径（メートル）
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // === 移動検知による送信判定 ===
    function shouldSendUpdate(position) {
        const now = Date.now();
        
        // 最小送信間隔チェック
        if (now - lastSentTime < CONFIG.MIN_TIME_BETWEEN_UPDATES) {
            return false;
        }
        
        // 初回送信または前回位置がない場合
        if (!lastSentPosition) {
            return true;
        }
        
        // 移動距離を計算
        const distance = calculateDistance(
            lastSentPosition.coords.latitude,
            lastSentPosition.coords.longitude,
            position.coords.latitude,
            position.coords.longitude
        );
        
        // 移動閾値を超えた場合
        if (distance >= CONFIG.MOVEMENT_THRESHOLD) {
            return true;
        }
        
        // 最大無送信時間を超えた場合（生存確認）
        if (now - lastSentTime >= CONFIG.MAX_TIME_WITHOUT_UPDATE) {
            return true;
        }
        
        return false;
    }
    // === マーカー重なり検出と配置調整 ===
    function adjustOverlappingMarkers(locations) {
        const OVERLAP_THRESHOLD = 15; // メートル単位での重なり判定距離
        const OFFSET_DISTANCE = 10;   // 重なり時のオフセット距離（ピクセル）
        
        // 重なりグループを検出
        const overlapGroups = [];
        const processedIds = new Set();
        
        locations.forEach((location, index) => {
            if (processedIds.has(location.participant_id)) return;
            
            const group = [location];
            processedIds.add(location.participant_id);
            
            // 他の参加者との距離をチェック
            locations.slice(index + 1).forEach(otherLocation => {
                if (processedIds.has(otherLocation.participant_id)) return;
                
                const distance = calculateDistance(
                    location.latitude, location.longitude,
                    otherLocation.latitude, otherLocation.longitude
                );
                
                if (distance <= OVERLAP_THRESHOLD) {
                    group.push(otherLocation);
                    processedIds.add(otherLocation.participant_id);
                }
            });
            
            overlapGroups.push(group);
        });
        
        return overlapGroups;
    }

    // === カスタムマーカー作成（重なり対応版） ===
    function createCustomMarkerWithOverlap(name, color, groupSize = 1, indexInGroup = 0) {
        const initials = getInitials(name);
        
        // 重なりがある場合の視覚的表現
        let markerStyle = `background-color: ${color};`;
        let extraContent = '';
        
        if (groupSize > 1) {
            // 重なりマーカーの場合は影を濃くして目立たせる
            markerStyle += `
                box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 2px white;
                border: 2px solid white;
                transform: scale(1.1);
                z-index: ${1000 + indexInGroup};
            `;
            
            // グループサイズを小さく表示
            if (indexInGroup === 0) {
                extraContent = `<div style="
                    position: absolute;
                    top: -15px;
                    right: -8px;
                    background: #ff4444;
                    color: white;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    border: 2px solid white;
                ">${groupSize}</div>`;
            }
        }
        
        const markerHtml = `
            <div class="custom-marker" style="${markerStyle}">
                ${initials}
                ${extraContent}
            </div>
        `;
        
        return L.divIcon({
            html: markerHtml,
            className: 'custom-div-icon',
            iconSize: [40, 40],
            iconAnchor: [20, 45],
            popupAnchor: [0, -40]
        });
    }