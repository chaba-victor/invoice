<?php

namespace Crater\Http\Controllers\V1\Storage;

use Crater\Http\Controllers\Controller;
use Illuminate\Support\Str;

class PublicStorageController extends Controller
{
    /**
     * Serve a file from the public storage disk.
     *
     * Web installs expose storage/app/public through the public/storage symlink,
     * so the web server answers these URLs directly. The desktop app keeps storage
     * outside the install directory where no symlink exists, so Laravel serves them.
     *
     * @param  string  $path
     * @return \Symfony\Component\HttpFoundation\BinaryFileResponse
     */
    public function __invoke($path)
    {
        $root = realpath(storage_path('app/public'));
        $file = $root ? realpath($root.DIRECTORY_SEPARATOR.$path) : false;

        if (! $file || ! Str::startsWith($file, $root.DIRECTORY_SEPARATOR) || ! is_file($file)) {
            abort(404);
        }

        return response()->file($file);
    }
}
