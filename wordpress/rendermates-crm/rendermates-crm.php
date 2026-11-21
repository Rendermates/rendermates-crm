<?php
/**
 * Plugin Name: Rendermates CRM — Website Leads
 * Description: Keeps the existing Elementor Atomic form and queues successful enquiries for the CRM.
 * Version: 1.0.0
 * Requires PHP: 8.2
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/src/connector.php';

add_action('admin_menu', [RM_CRM_Connector::class, 'menu']);
add_action('admin_post_rm_crm_configure', [RM_CRM_Connector::class, 'configure']);
add_action('admin_post_rm_crm_retry', [RM_CRM_Connector::class, 'retry']);
add_action('rm_crm_deliver', [RM_CRM_Connector::class, 'deliver']);
add_filter('cron_schedules', [RM_CRM_Connector::class, 'schedules']);
foreach (['wp_ajax_', 'wp_ajax_nopriv_'] as $prefix) {
    add_action($prefix . 'elementor_pro_atomic_forms_send_form', [RM_CRM_Connector::class, 'capture'], 0);
}
register_activation_hook(__FILE__, [RM_CRM_Connector::class, 'activate']);
register_deactivation_hook(__FILE__, [RM_CRM_Connector::class, 'deactivate']);
