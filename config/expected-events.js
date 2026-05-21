// GA4 recommended events per site type. Edit freely to fit your house standard.

module.exports = {
  ecommerce: {
    critical: [
      'page_view',
      'view_item',
      'add_to_cart',
      'begin_checkout',
      'purchase',
    ],
    recommended: [
      'view_item_list',
      'select_item',
      'view_cart',
      'add_to_wishlist',
      'remove_from_cart',
      'add_shipping_info',
      'add_payment_info',
      'view_promotion',
      'select_promotion',
      'refund',
    ],
  },
  leadgen: {
    critical: [
      'page_view',
      'generate_lead',
      'form_submit',
    ],
    recommended: [
      'sign_up',
      'login',
      'view_search_results',
      'file_download',
      'video_start',
      'video_complete',
      'cta_click',
    ],
  },
};
