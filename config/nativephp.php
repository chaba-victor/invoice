<?php

return [
    /*
    |--------------------------------------------------------------------------
    | NativePHP Application Configuration
    |--------------------------------------------------------------------------
    |
    | Configuration options for the self-contained native desktop app
    | bundling embedded PHP binary and local SQLite storage.
    |
    */

    'app_id' => 'com.invoice.app',

    'version' => '1.0.0',

    'author' => 'Invoice, Inc.',

    'provider' => App\Providers\NativeAppServiceProvider::class,

    'database' => [
        'connection' => 'sqlite',
        'database' => env('NATIVEPHP_DB_PATH', database_path('database.sqlite')),
    ],

    'window' => [
        'width' => 1280,
        'height' => 800,
        'min_width' => 900,
        'min_height' => 600,
        'title' => 'Invoice',
        'resizable' => true,
        'show_menu_bar' => false,
    ],
];
