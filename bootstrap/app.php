<?php

/*
|--------------------------------------------------------------------------
| Create The Application
|--------------------------------------------------------------------------
|
| The first thing we will do is create a new Laravel application instance
| which serves as the "glue" for all the components of Laravel, and is
| the IoC container for the system binding all of the various parts.
|
*/

$app = new Illuminate\Foundation\Application(
    realpath(__DIR__.'/../')
);

/*
|--------------------------------------------------------------------------
| Desktop Data Directory
|--------------------------------------------------------------------------
|
| The desktop app installs the code read-only and passes INVOICE_DATA_DIR,
| a per-user directory that holds everything the app writes: .env, the
| storage directory and Laravel's bootstrap caches. Without it, the app
| keeps its usual layout.
|
*/

if ($dataDir = getenv('INVOICE_DATA_DIR')) {
    $dataDir = rtrim($dataDir, '\\/');

    foreach ([
        'cache',
        'storage/app/public',
        'storage/framework/cache/data',
        'storage/framework/sessions',
        'storage/framework/views',
        'storage/fonts',
        'storage/logs',
    ] as $dir) {
        if (! is_dir($dataDir.'/'.$dir)) {
            mkdir($dataDir.'/'.$dir, 0755, true);
        }
    }

    $app->useStoragePath($dataDir.'/storage');
    $app->useEnvironmentPath($dataDir);

    foreach ([
        'APP_CONFIG_CACHE' => 'config.php',
        'APP_ROUTES_CACHE' => 'routes-v7.php',
        'APP_SERVICES_CACHE' => 'services.php',
        'APP_PACKAGES_CACHE' => 'packages.php',
        'APP_EVENTS_CACHE' => 'events.php',
    ] as $key => $file) {
        $_ENV[$key] = $_SERVER[$key] = $dataDir.'/cache/'.$file;
    }
}

/*
|--------------------------------------------------------------------------
| Bind Important Interfaces
|--------------------------------------------------------------------------
|
| Next, we need to bind some important interfaces into the container so
| we will be able to resolve them when needed. The kernels serve the
| incoming requests to this application from both the web and CLI.
|
*/

$app->singleton(
    Illuminate\Contracts\Http\Kernel::class,
    Crater\Http\Kernel::class
);

$app->singleton(
    Illuminate\Contracts\Console\Kernel::class,
    Crater\Console\Kernel::class
);

$app->singleton(
    Illuminate\Contracts\Debug\ExceptionHandler::class,
    Crater\Exceptions\Handler::class
);

/*
|--------------------------------------------------------------------------
| Return The Application
|--------------------------------------------------------------------------
|
| This script returns the application instance. The instance is given to
| the calling script so we can separate the building of the instances
| from the actual running of the application and sending responses.
|
*/

return $app;
