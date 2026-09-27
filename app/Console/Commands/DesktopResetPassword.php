<?php

namespace Crater\Console\Commands;

use Crater\Models\Company;
use Crater\Models\Setting;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class DesktopResetPassword extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'desktop:reset-password {--show : Only show which account would be reset}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = "Set a new password for the desktop app owner's account (from INVOICE_NEW_PASSWORD).";

    /**
     * Execute the console command.
     *
     * The desktop app can't send reset emails, so its "Reset Invoice password" shortcut uses
     * this instead. Running it requires the Windows account that holds the data, which can
     * already read the data files, so it adds no new way in.
     *
     * @return int
     */
    public function handle()
    {
        if (! getenv('INVOICE_DATA_DIR')) {
            return $this->report(['ok' => false, 'error' => 'desktop:reset-password only runs in the desktop app.'], 1);
        }

        $owner = Setting::getSetting('profile_complete') === 'COMPLETED'
            ? optional(Company::orderBy('id')->first())->owner
            : null;

        if (! $owner) {
            return $this->report(['ok' => false, 'error' => 'Invoice has not been set up yet. Open Invoice to create your account.'], 1);
        }

        if ($this->option('show')) {
            return $this->report(['ok' => true, 'name' => $owner->name, 'email' => $owner->email]);
        }

        // Passed in the environment so it never appears in a process list.
        $password = (string) getenv('INVOICE_NEW_PASSWORD');

        if (mb_strlen($password) < 8) {
            return $this->report(['ok' => false, 'error' => 'The password must be at least 8 characters.'], 1);
        }

        $owner->password = $password;
        $owner->setRememberToken(null);
        $owner->save();

        // Sign everyone out, so the old password no longer grants access through a saved session.
        File::cleanDirectory(storage_path('framework/sessions'));

        return $this->report(['ok' => true, 'email' => $owner->email]);
    }

    protected function report(array $report, $code = 0)
    {
        $this->line('DESKTOP_REPORT '.json_encode($report));

        return $code;
    }
}
