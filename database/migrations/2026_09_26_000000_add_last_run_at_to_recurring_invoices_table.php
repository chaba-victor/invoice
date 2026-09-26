<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddLastRunAtToRecurringInvoicesTable extends Migration
{
    /**
     * The last schedule occurrence an invoice was generated for. Lets missed occurrences be
     * caught up (the desktop app is often closed when one comes due) without generating the
     * same occurrence twice.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('recurring_invoices', function (Blueprint $table) {
            $table->timestamp('last_run_at')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('recurring_invoices', function (Blueprint $table) {
            $table->dropColumn('last_run_at');
        });
    }
}
