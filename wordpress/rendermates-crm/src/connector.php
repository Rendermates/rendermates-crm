<?php

final class RM_CRM_Connector
{
    private const PROJECT = 'rendermates-crm';
    private const ACCOUNT = 'crm-website-intake@rendermates-crm.iam.gserviceaccount.com';
    private const QUEUE = '_rm_crm_lead_';
    private const CONFIG = '_rm_crm_credentials';
    private const STATUS = '_rm_crm_status';

    public static function schedules(array $schedules): array
    {
        $schedules['rm_crm_five_minutes'] = ['interval' => 300, 'display' => 'CRM delivery every five minutes'];
        return $schedules;
    }

    public static function activate(): void
    {
        if (!wp_next_scheduled('rm_crm_deliver')) {
            wp_schedule_event(time() + 60, 'rm_crm_five_minutes', 'rm_crm_deliver');
        }
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook('rm_crm_deliver');
        // Do not delete queued enquiries or credentials when deactivating.
    }

    public static function menu(): void
    {
        add_options_page('Rendermates CRM', 'Rendermates CRM', 'manage_options', 'rendermates-crm', [self::class, 'page']);
    }

    public static function page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $configured = (bool) get_option(self::CONFIG);
        $status = get_option(self::STATUS, ['code' => 'not_connected', 'at' => '']);
        echo '<div class="wrap"><h1>Rendermates CRM</h1>';
        echo '<p>Existing form: On-site assessment request. New enquiries go to New Leads, without scheduled dates.</p>';
        echo '<p>Connection: <strong>' . ($configured ? 'Configured — verify with a fictional enquiry' : 'Not configured') . '</strong></p>';
        echo '<p>Last delivery status: <code>' . esc_html($status['code']) . '</code> ' . esc_html($status['at']) . '</p>';
        echo '<p>Pending enquiries: <strong>' . esc_html((string) self::pending_count()) . '</strong></p>';
        echo '<p>Photos and other files stay in the existing Elementor workflow. They are not uploaded to the CRM by this connector.</p>';
        echo '<p>Upload only the dedicated create-only service-account JSON. Do not use an owner, editor, calendar or Firebase administrator key.</p>';
        echo '<form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '">';
        echo '<input type="hidden" name="action" value="rm_crm_configure">';
        wp_nonce_field('rm_crm_configure');
        echo '<input type="file" name="credential" accept=".json,application/json" required>';
        submit_button($configured ? 'Replace connection credential' : 'Configure connection');
        echo '</form><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        echo '<input type="hidden" name="action" value="rm_crm_retry">';
        wp_nonce_field('rm_crm_retry');
        submit_button('Send pending enquiries now', 'secondary');
        echo '</form><p>Delivery uses WordPress Cron. Keep a hosting cron configured if WP-Cron is disabled. Pending enquiries are retained on failure.</p></div>';
    }

    public static function configure(): void
    {
        self::admin_guard('rm_crm_configure');
        $file = $_FILES['credential'] ?? [];
        if (($file['error'] ?? -1) !== UPLOAD_ERR_OK ||
            ($file['size'] ?? 0) > 16384 ||
            !is_uploaded_file($file['tmp_name'] ?? '')) {
            wp_die('Choose the dedicated service-account JSON file. No credentials were saved.');
        }
        $raw = file_get_contents($file['tmp_name']);
        try {
            $credential = self::validate_credential(json_decode($raw, true, 16, JSON_THROW_ON_ERROR));
            update_option(self::CONFIG, self::seal($credential), false);
            self::status('configured_not_tested');
        } catch (Throwable $error) {
            // Never display credential contents or upstream responses.
            wp_die('Credential could not be saved. Check the account, project and OpenSSL support.');
        }
        self::redirect();
    }

    public static function retry(): void
    {
        self::admin_guard('rm_crm_retry');
        self::deliver();
        self::redirect();
    }

    private static function admin_guard(string $action): void
    {
        if (!current_user_can('manage_options')) {
            wp_die('Not permitted.', '', ['response' => 403]);
        }
        check_admin_referer($action);
    }

    private static function redirect(): void
    {
        wp_safe_redirect(admin_url('options-general.php?page=rendermates-crm'));
        exit;
    }

    public static function validate_credential($credential): array
    {
        if (!is_array($credential) ||
            ($credential['type'] ?? '') !== 'service_account' ||
            ($credential['project_id'] ?? '') !== self::PROJECT ||
            ($credential['client_email'] ?? '') !== self::ACCOUNT ||
            !is_string($credential['private_key'] ?? null) ||
            !openssl_pkey_get_private($credential['private_key'])) {
            throw new RuntimeException('invalid_credential');
        }
        $details = openssl_pkey_get_details(openssl_pkey_get_private($credential['private_key']));
        if ($details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 2048) {
            throw new RuntimeException('invalid_signing_key');
        }
        // Never trust token_uri, project URLs or arbitrary destinations in an uploaded file.
        return [
            'type' => 'service_account',
            'project_id' => self::PROJECT,
            'client_email' => self::ACCOUNT,
            'private_key' => $credential['private_key'],
        ];
    }

    public static function seal(array $credential): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt(
            wp_json_encode($credential),
            'aes-256-gcm',
            hash('sha256', wp_salt('auth'), true),
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );
        if ($cipher === false) {
            throw new RuntimeException('encryption_failed');
        }
        return base64_encode($iv . $tag . $cipher);
    }

    public static function unseal(string $sealed): array
    {
        $bytes = base64_decode($sealed, true);
        if ($bytes === false || strlen($bytes) < 29) {
            throw new RuntimeException('invalid_configuration');
        }
        $plain = openssl_decrypt(
            substr($bytes, 28),
            'aes-256-gcm',
            hash('sha256', wp_salt('auth'), true),
            OPENSSL_RAW_DATA,
            substr($bytes, 0, 12),
            substr($bytes, 12, 16)
        );
        if ($plain === false) {
            throw new RuntimeException('configuration_unreadable');
        }
        return self::validate_credential(json_decode($plain, true, 16, JSON_THROW_ON_ERROR));
    }

    public static function capture(): void
    {
        // Let Elementor validate its nonce, spam checks, required fields and actions.
        // Observe its final success JSON, never replace or re-run its submission.
        if (!get_option(self::CONFIG) ||
            (string) ($_POST['post_id'] ?? '') !== '5507' ||
            (string) ($_POST['form_id'] ?? '') !== '646e94a1') {
            return;
        }
        try {
            $lead = self::map_fields(wp_unslash($_POST['form_fields'] ?? []));
        } catch (Throwable $error) {
            self::status('field_mapping_failed');
            return;
        }
        $response = '';
        ob_start(static function (string $chunk, int $phase) use (&$response, $lead): string {
            // Bound the observer buffer; it never changes Elementor's response.
            if (strlen($response) <= 1048576) {
                $response .= $chunk;
            }
            if (($phase & PHP_OUTPUT_HANDLER_FINAL) && !($phase & PHP_OUTPUT_HANDLER_CLEAN)) {
                try {
                    self::observe_response($response, $lead);
                } catch (Throwable $error) {
                    // A connector/storage error must not break Elementor's original response.
                    self::status('queue_storage_failed');
                }
            }
            return $chunk;
        });
    }

    public static function observe_response(string $response, array $lead): bool
    {
        $result = json_decode($response, true);
        if (!is_array($result) || ($result['success'] ?? null) !== true) {
            return false;
        }
        $id = 'website-' . wp_generate_uuid4();
        $saved = add_option(self::QUEUE . $id, [
            'id' => $id, 'lead' => $lead, 'attempts' => 0, 'next' => time(),
        ], '', false);
        if ($saved) {
            wp_schedule_single_event(time() + 1, 'rm_crm_deliver');
            self::status('queued');
        } else {
            self::status('queue_storage_failed');
        }
        return $saved;
    }

    public static function map_fields($fields): array
    {
        if (!is_array($fields)) {
            throw new RuntimeException('invalid_fields');
        }
        $values = [];
        $names = ['rm-name', 'rm-phone', 'rm-email', 'rm-address', 'e-form-textarea-11'];
        foreach ($fields as $field) {
            if (!is_array($field)) {
                continue;
            }
            $name = $field['name'] ?? '';
            if (!is_string($name) || !in_array($name, $names, true)) {
                continue;
            }
            if (isset($values[$name]) || !is_string($field['value'] ?? null) || strlen($field['value']) > 20000) {
                throw new RuntimeException('invalid_field');
            }
            $values[$name] = trim($name === 'e-form-textarea-11'
                ? sanitize_textarea_field($field['value'])
                : sanitize_text_field($field['value']));
        }
        foreach (['rm-name', 'rm-phone', 'rm-email', 'rm-address'] as $name) {
            if (empty($values[$name]) || strlen($values[$name]) > 1000) {
                throw new RuntimeException('missing_field');
            }
        }
        if (!is_email($values['rm-email'])) {
            throw new RuntimeException('invalid_email');
        }
        return [
            'clientName' => $values['rm-name'],
            'phone' => $values['rm-phone'],
            'email' => $values['rm-email'],
            'address' => $values['rm-address'],
            'message' => $values['e-form-textarea-11'] ?? '',
            'status' => 'lead',
            'source' => 'website',
            'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'websiteForm' => 'On-site assessment request',
            'websiteAttachmentsLocation' => 'Existing Elementor submission workflow; files are not copied to the CRM.',
        ];
    }

    private static function status(string $code): void
    {
        update_option(self::STATUS, ['code' => $code, 'at' => gmdate('Y-m-d H:i:s') . ' UTC'], false);
    }

    private static function pending_count(): int
    {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s",
            $wpdb->esc_like(self::QUEUE) . '%'
        ));
    }

    public static function deliver(): void
    {
        global $wpdb;
        if (!get_option(self::CONFIG)) {
            return;
        }
        // Overlapping runners are harmless: Firestore createDocument is idempotent by queue id.
        $keys = $wpdb->get_col($wpdb->prepare(
            "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s ORDER BY option_id",
            $wpdb->esc_like(self::QUEUE) . '%'
        ));
        $processed = 0;
        foreach ($keys as $key) {
            $entry = get_option($key);
            if (!is_array($entry) || ($entry['next'] ?? PHP_INT_MAX) > time()) {
                continue;
            }
            if ($processed++ >= 5) {
                break;
            }
            try {
                self::send($entry);
                delete_option($key);
                self::status('delivered');
            } catch (Throwable $error) {
                // Keep the original id and complete payload for the next attempt.
                $entry['attempts']++;
                $entry['next'] = time() + min(3600, 60 * (2 ** min(6, $entry['attempts'])));
                update_option($key, $entry, false);
                self::status('delivery_pending_check_connection');
            }
        }
    }

    private static function b64url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    public static function access_token(array $credential): string
    {
        $cache = 'rm_crm_token_' . substr(hash('sha256', $credential['private_key']), 0, 20);
        $cached = get_transient($cache);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }
        $now = time();
        $claims = [
            'iss' => self::ACCOUNT,
            'scope' => 'https://www.googleapis.com/auth/datastore',
            'aud' => 'https://oauth2.googleapis.com/token',
            'iat' => $now, 'exp' => $now + 3600,
        ];
        $unsigned = self::b64url('{"alg":"RS256","typ":"JWT"}') . '.' . self::b64url(wp_json_encode($claims));
        $signature = '';
        if (!openssl_sign($unsigned, $signature, $credential['private_key'], OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('sign_failed');
        }
        $response = wp_remote_post('https://oauth2.googleapis.com/token', [
            'timeout' => 10, 'redirection' => 0,
            'body' => [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $unsigned . '.' . self::b64url($signature),
            ],
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
            throw new RuntimeException('token_failed');
        }
        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($data) || !is_string($data['access_token'] ?? null) || $data['access_token'] === '') {
            throw new RuntimeException('token_invalid');
        }
        set_transient($cache, $data['access_token'], min(3300, max(1, (int) ($data['expires_in'] ?? 3600) - 60)));
        return $data['access_token'];
    }

    public static function send(array $entry): void
    {
        if (!preg_match('/^website-[a-f0-9-]{36}$/D', $entry['id'] ?? '')) {
            throw new RuntimeException('invalid_id');
        }
        $credential = self::unseal((string) get_option(self::CONFIG));
        $fields = [];
        foreach ($entry['lead'] as $key => $value) {
            $fields[$key] = [$key === 'createdAt' ? 'timestampValue' : 'stringValue' => $value];
        }
        $url = 'https://firestore.googleapis.com/v1/projects/' . self::PROJECT .
            '/databases/(default)/documents/jobs?documentId=' . rawurlencode($entry['id']);
        $response = wp_remote_post($url, [
            'timeout' => 10, 'redirection' => 0,
            'headers' => [
                'Authorization' => 'Bearer ' . self::access_token($credential),
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode(['fields' => $fields]),
        ]);
        if (is_wp_error($response)) {
            throw new RuntimeException('delivery_failed');
        }
        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        // A previous successful create whose response was lost must not duplicate or overwrite.
        if ($code === 409 && ($body['error']['status'] ?? '') === 'ALREADY_EXISTS') {
            return;
        }
        if ($code !== 200) {
            throw new RuntimeException('delivery_rejected');
        }
    }
}
