# tracker/views.py
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from django.contrib import messages
from django.core.mail import send_mail
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import json
import uuid
import logging
from .models import LocationSession, LocationData, SessionLog

# ログ設定
logger = logging.getLogger(__name__)

def home(request):
    """ホームページ"""
    return render(request, 'tracker/home.html')

def contact(request):
    """お問い合わせページ"""
    if request.method == 'POST':
        try:
            # フォームデータを取得
            name = request.POST.get('name', '').strip()
            email = request.POST.get('email', '').strip()
            subject_category = request.POST.get('subject_category', '')
            subject = request.POST.get('subject', '').strip()
            message = request.POST.get('message', '').strip()
            
            # 使用環境情報
            user_agent = request.POST.get('user_agent', '')
            screen_resolution = request.POST.get('screen_resolution', '')
            browser_language = request.POST.get('browser_language', '')
            
            # バリデーション
            errors = []
            if not name:
                errors.append('お名前を入力してください。')
            if not email:
                errors.append('メールアドレスを入力してください。')
            elif '@' not in email or '.' not in email:
                errors.append('有効なメールアドレスを入力してください。')
            if not subject_category:
                errors.append('お問い合わせ種類を選択してください。')
            if not message:
                errors.append('メッセージを入力してください。')
            if len(message) > 2000:
                errors.append('メッセージは2000文字以内で入力してください。')
            
            if errors:
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({
                        'success': False,
                        'message': '\n'.join(errors)
                    })
                else:
                    for error in errors:
                        messages.error(request, error)
                    return render(request, 'tracker/contact.html')
            
            # 件名カテゴリーの日本語変換
            category_map = {
                'technical': '技術的な問題',
                'feature': '機能に関するご要望',
                'bug': 'バグ報告',
                'general': '一般的なお問い合わせ',
                'other': 'その他'
            }
            category_text = category_map.get(subject_category, subject_category)
            
            # メール件名の生成
            if subject:
                email_subject = f'[チョイシェアMAP] {category_text}: {subject}'
            else:
                email_subject = f'[チョイシェアMAP] {category_text}'
            
            # 現在時刻を取得
            current_time = timezone.now()
            
            # メール本文の生成（管理者用）
            email_context = {
                'name': name,
                'email': email,
                'category': category_text,
                'subject': subject,
                'message': message,
                'user_agent': user_agent,
                'screen_resolution': screen_resolution,
                'browser_language': browser_language,
                'ip_address': get_client_ip(request),
                'timestamp': current_time,
                'submitted_at': current_time,  # テンプレート用に追加
            }
            
            # 自動返信用のコンテキスト
            auto_reply_context = {
                'name': name,
                'email': email,
                'category': category_text,
                'subject': subject,
                'message': message,
                'submitted_at': current_time,  # この変数が重要
            }
            
            # HTMLメールテンプレート（管理者用）
            html_message = render_to_string('tracker/email/contact_notification.html', email_context)
            plain_message = strip_tags(html_message)
            
            # 管理者へのメール送信
            try:
                admin_email = getattr(settings, 'CONTACT_EMAIL', settings.DEFAULT_FROM_EMAIL)
                
                # デバッグ用ログ出力
                logger.info(f'Sending email to admin: {admin_email}')
                logger.info(f'Email subject: {email_subject}')
                logger.info(f'From email: {settings.DEFAULT_FROM_EMAIL}')
                
                send_mail(
                    subject=email_subject,
                    message=plain_message,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[admin_email],
                    html_message=html_message,
                    fail_silently=False,
                )
                
                logger.info('Admin email sent successfully')
                
                # 送信者への自動返信メール
                auto_reply_html = render_to_string('tracker/email/contact_auto_reply.html', auto_reply_context)
                auto_reply_plain = strip_tags(auto_reply_html)
                
                logger.info(f'Sending auto-reply to: {email}')
                
                send_mail(
                    subject='[チョイシェアMAP] お問い合わせを受け付けました',
                    message=auto_reply_plain,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[email],
                    html_message=auto_reply_html,
                    fail_silently=True,  # 自動返信は失敗してもOK
                )
                
                logger.info('Auto-reply email sent successfully')
                logger.info(f'Contact form submitted: {name} <{email}> - {category_text}')
                
            except Exception as e:
                logger.error(f'Failed to send contact email: {str(e)}')
                # より詳細なエラー情報をログに出力
                import traceback
                logger.error(f'Email error traceback: {traceback.format_exc()}')
                
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({
                        'success': False,
                        'message': f'メール送信でエラーが発生しました: {str(e)}'
                    })
                else:
                    messages.error(request, f'メール送信でエラーが発生しました: {str(e)}')
                    return render(request, 'tracker/contact.html')
            
            # 成功時のレスポンス
            success_message = 'お問い合わせありがとうございます。メッセージを正常に送信いたしました。内容を確認次第、ご返信させていただきます。'
            
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': True,
                    'message': success_message
                })
            else:
                messages.success(request, success_message)
                return redirect('tracker:contact')
                
        except Exception as e:
            logger.error(f'Contact form error: {str(e)}')
            import traceback
            logger.error(f'Contact form error traceback: {traceback.format_exc()}')
            
            error_message = f'予期しないエラーが発生しました: {str(e)}'
            
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({
                    'success': False,
                    'message': error_message
                })
            else:
                messages.error(request, error_message)
                return render(request, 'tracker/contact.html')
    
    # GET リクエストの場合
    return render(request, 'tracker/contact.html')

@require_http_methods(["POST"])
def create_session(request):
    """新しい位置共有セッションを作成"""
    duration = int(request.POST.get('duration', 30))
    
    if duration not in [choice[0] for choice in LocationSession.DURATION_CHOICES]:
        messages.error(request, '無効な時間設定です。')
        return redirect('tracker:home')
    
    session = LocationSession.objects.create(duration_minutes=duration)
    
    # ログ記録
    SessionLog.objects.create(
        session=session,
        action='created',
        ip_address=get_client_ip(request),
        user_agent=request.META.get('HTTP_USER_AGENT', '')
    )
    
    return redirect('tracker:session_created', session_id=session.session_id)

def session_created(request, session_id):
    """セッション作成完了ページ"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        messages.error(request, 'このセッションは期限切れです。')
        return redirect('tracker:home')
    
    context = {
        'session': session,
        'share_url': request.build_absolute_uri(f'/share/{session_id}'),
        'expires_at': session.expires_at,
    }
    return render(request, 'tracker/session_created.html', context)

def share_location(request, session_id):
    """位置情報共有ページ"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        return render(request, 'tracker/expired.html', {'session': session})
    
    # 参加者IDをセッションで管理
    participant_id = request.session.get(f'participant_{session_id}')
    if not participant_id:
        participant_id = str(uuid.uuid4())
        request.session[f'participant_{session_id}'] = participant_id
    
    # WebSocket用の設定を追加
    context = {
        'session': session,
        'participant_id': participant_id,
        'expires_at': session.expires_at,
        'websocket_url': f'ws://{request.get_host()}/ws/location/{session_id}/',  # 本番環境ではwss://を使用
    }
    return render(request, 'tracker/share.html', context)

# WebSocket通知用のヘルパー関数
def notify_location_update(session_id, locations_data):
    """WebSocketで位置情報更新を全参加者に通知"""
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f'location_{session_id}',
            {
                'type': 'location_broadcast',
                'locations': locations_data
            }
        )

def get_all_locations_data(session):
    """セッション内の全位置情報を取得"""
    locations = LocationData.objects.filter(session=session, is_active=True)
    return [
        {
            'participant_id': location.participant_id,
            'participant_name': location.participant_name or f'参加者{location.participant_id[:8]}',
            'latitude': float(location.latitude),
            'longitude': float(location.longitude),
            'accuracy': location.accuracy,
            'last_updated': location.last_updated.isoformat(),
            'is_background': location.is_background,
        }
        for location in locations
    ]

@csrf_exempt
@require_http_methods(["POST"])
def api_update_location(request, session_id):
    """位置情報更新API（HTTP互換性のために保持）"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        return JsonResponse({'error': 'セッションが期限切れです'}, status=400)
    
    try:
        data = json.loads(request.body)
        participant_id = data.get('participant_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        accuracy = data.get('accuracy')
        participant_name = data.get('participant_name', '')
        is_background = data.get('is_background', False)
        
        if not all([participant_id, latitude, longitude]):
            return JsonResponse({'error': '必要なパラメータが不足しています'}, status=400)
        
        # 位置情報を更新または作成
        location, created = LocationData.objects.update_or_create(
            session=session,
            participant_id=participant_id,
            defaults={
                'latitude': latitude,
                'longitude': longitude,
                'accuracy': accuracy,
                'participant_name': participant_name,
                'is_background': is_background,
                'is_active': True,
            }
        )
        
        # 初回参加のログ記録
        if created:
            SessionLog.objects.create(
                session=session,
                action='joined',
                participant_id=participant_id,
                ip_address=get_client_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')
            )
        
        # WebSocketで全参加者に通知
        locations_data = get_all_locations_data(session)
        notify_location_update(session_id, locations_data)
        
        return JsonResponse({'success': True, 'message': '位置情報を更新しました'})
        
    except json.JSONDecodeError:
        return JsonResponse({'error': '無効なJSONデータです'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@require_http_methods(["GET"])
def api_get_locations(request, session_id):
    """セッション内の全位置情報取得API（HTTP互換性のために保持）"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        return JsonResponse({'error': 'セッションが期限切れです'}, status=400)
    
    locations_data = get_all_locations_data(session)
    
    return JsonResponse({
        'locations': locations_data,
        'expires_at': session.expires_at.isoformat(),
        'is_expired': session.is_expired(),
    })

@csrf_exempt
@require_http_methods(["POST"])
def api_offline_status(request, session_id):
    """オフライン状態通知API（HTTP互換性のために保持）"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        return JsonResponse({'error': 'セッションが期限切れです'}, status=400)
    
    try:
        data = json.loads(request.body)
        participant_id = data.get('participant_id')
        is_background = data.get('is_background', False)
        
        if not participant_id:
            return JsonResponse({'error': 'participant_idが必要です'}, status=400)
        
        # 既存の位置情報のis_backgroundフラグを更新
        LocationData.objects.filter(
            session=session, 
            participant_id=participant_id
        ).update(is_background=is_background, last_updated=timezone.now())
        
        # WebSocketで全参加者に通知
        locations_data = get_all_locations_data(session)
        notify_location_update(session_id, locations_data)
        
        return JsonResponse({'success': True, 'message': 'オフライン状態を更新しました'})
        
    except json.JSONDecodeError:
        return JsonResponse({'error': '無効なJSONデータです'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def api_session_ping(request, session_id):
    """セッション維持用pingAPI（HTTP互換性のために保持）"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    if session.is_expired():
        return JsonResponse({'error': 'セッションが期限切れです'}, status=400)
    
    try:
        data = json.loads(request.body)
        participant_id = data.get('participant_id')
        is_background = data.get('is_background', False)
        
        if not participant_id:
            return JsonResponse({'error': 'participant_idが必要です'}, status=400)
        
        # 既存の位置情報のis_backgroundフラグとlast_updatedを更新
        LocationData.objects.filter(
            session=session, 
            participant_id=participant_id
        ).update(is_background=is_background, last_updated=timezone.now())
        
        return JsonResponse({'success': True, 'message': 'セッションを維持しました'})
        
    except json.JSONDecodeError:
        return JsonResponse({'error': '無効なJSONデータです'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def api_leave_session(request, session_id):
    """セッションから退出API（HTTP互換性のために保持）"""
    session = get_object_or_404(LocationSession, session_id=session_id)
    
    try:
        data = json.loads(request.body)
        participant_id = data.get('participant_id')
        
        if not participant_id:
            return JsonResponse({'error': 'participant_idが必要です'}, status=400)
        
        # 位置情報を非アクティブに設定
        LocationData.objects.filter(
            session=session, 
            participant_id=participant_id
        ).update(is_active=False)
        
        # ログ記録
        SessionLog.objects.create(
            session=session,
            action='left',
            participant_id=participant_id,
            ip_address=get_client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT', '')
        )
        
        # WebSocketで全参加者に通知
        locations_data = get_all_locations_data(session)
        notify_location_update(session_id, locations_data)
        
        return JsonResponse({'success': True, 'message': 'セッションから退出しました'})
        
    except json.JSONDecodeError:
        return JsonResponse({'error': '無効なJSONデータです'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

def get_client_ip(request):
    """クライアントのIPアドレスを取得"""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip