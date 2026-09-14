@module:07-bot @be @bot
Feature: The trading bot over PerpDEX

  The bot is both a tool and an object of test. Its risk gate is a pure
  function -- it decides without a network, so it is tested without one. Its
  operational discipline over the live chain -- surfacing a revert instead of
  looping on it, sequential nonces, returning to flat -- is tested against a
  fresh anvil.

  Risk-gate scenarios carry no @perpdex tag and never touch the chain. The rest
  snapshot and revert the chain like every other PerpDEX scenario, and each
  leaves the venue flat behind it.

  # ---------------------------------------------------------------- risk gate (no chain)

  @case:230
  Scenario: The risk gate rounds size to the step and price to the tick
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 1.2345 ETH at 2500.567
    Then the order is cleared to send
    And the planned size is 1.234 ETH
    And the planned price is 2500.56

  @case:231
  Scenario: The kill switch refuses every order
    Given a risk-only bot with max order size 100 and max position 100
    And the kill switch is engaged
    When it plans a buy of 1 ETH at 2500
    Then the order is refused with reason "kill-switch"

  @case:232
  Scenario: An order above the max order size is refused
    Given a risk-only bot with max order size 5 and max position 100
    When it plans a buy of 6 ETH at 2500
    Then the order is refused with reason "max-order-size"

  @case:233
  Scenario: An order that would breach the max position is refused, but a reduce-only order is not
    Given a risk-only bot with max order size 100 and max position 10
    When it plans a buy of 4 ETH at 2500 against an existing position of 7 ETH
    Then the order is refused with reason "max-position"
    When it plans a reduce-only sell of 4 ETH at 2500 against an existing position of 7 ETH
    Then the order is cleared to send

  @case:234
  Scenario: A size that rounds to zero at the step is refused
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 0.0005 ETH at 2500
    Then the order is refused with reason "zero-size"

  @case:235
  Scenario: An order below the minimum notional is refused
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 0.001 ETH at 2500
    Then the order is refused with reason "below-min-notional"

  @case:236
  Scenario: A repeated userOrderId is a no-op, not a second order
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 1 ETH at 2500 with user order id 1
    Then the order is cleared to send
    When it plans a buy of 1 ETH at 2500 with user order id 1
    Then the order is a duplicate

  @case:237
  Scenario: Dry run clears an order but does not send it
    Given a risk-only bot with max order size 100 and max position 100
    And dry run is engaged
    When it plans a buy of 1 ETH at 2500
    Then the order is cleared as a dry run

  # ---------------------------------------------------------------- gates the contract enforces


  Scenario Outline: An order of <size> ETH over max order size <max> is refused
    Given a risk-only bot with max order size <max> and max position 1000000
    When it plans a buy of <size> ETH at 2500
    Then the order is refused with reason "max-order-size"

    @case:304
    Examples:
      | max | size |
      | 1 | 2 |
    @case:305
    Examples:
      | max | size |
      | 1 | 3 |
    @case:306
    Examples:
      | max | size |
      | 1 | 4 |
    @case:307
    Examples:
      | max | size |
      | 2 | 3 |
    @case:308
    Examples:
      | max | size |
      | 2 | 4 |
    @case:309
    Examples:
      | max | size |
      | 2 | 5 |
    @case:310
    Examples:
      | max | size |
      | 3 | 4 |
    @case:311
    Examples:
      | max | size |
      | 3 | 5 |
    @case:312
    Examples:
      | max | size |
      | 3 | 6 |
    @case:313
    Examples:
      | max | size |
      | 4 | 5 |
    @case:314
    Examples:
      | max | size |
      | 4 | 6 |
    @case:315
    Examples:
      | max | size |
      | 4 | 7 |
    @case:316
    Examples:
      | max | size |
      | 5 | 6 |
    @case:317
    Examples:
      | max | size |
      | 5 | 7 |
    @case:318
    Examples:
      | max | size |
      | 5 | 8 |
    @case:319
    Examples:
      | max | size |
      | 6 | 7 |
    @case:320
    Examples:
      | max | size |
      | 6 | 8 |
    @case:321
    Examples:
      | max | size |
      | 6 | 9 |
    @case:322
    Examples:
      | max | size |
      | 7 | 8 |
    @case:323
    Examples:
      | max | size |
      | 7 | 9 |
    @case:324
    Examples:
      | max | size |
      | 7 | 10 |
    @case:325
    Examples:
      | max | size |
      | 8 | 9 |
    @case:326
    Examples:
      | max | size |
      | 8 | 10 |
    @case:327
    Examples:
      | max | size |
      | 8 | 11 |
    @case:328
    Examples:
      | max | size |
      | 9 | 10 |
    @case:329
    Examples:
      | max | size |
      | 9 | 11 |
    @case:330
    Examples:
      | max | size |
      | 9 | 12 |
    @case:331
    Examples:
      | max | size |
      | 10 | 11 |
    @case:332
    Examples:
      | max | size |
      | 10 | 12 |
    @case:333
    Examples:
      | max | size |
      | 10 | 13 |
    @case:334
    Examples:
      | max | size |
      | 11 | 12 |
    @case:335
    Examples:
      | max | size |
      | 11 | 13 |
    @case:336
    Examples:
      | max | size |
      | 11 | 14 |
    @case:337
    Examples:
      | max | size |
      | 12 | 13 |
    @case:338
    Examples:
      | max | size |
      | 12 | 14 |
    @case:339
    Examples:
      | max | size |
      | 12 | 15 |
    @case:340
    Examples:
      | max | size |
      | 13 | 14 |
    @case:341
    Examples:
      | max | size |
      | 13 | 15 |
    @case:342
    Examples:
      | max | size |
      | 13 | 16 |
    @case:343
    Examples:
      | max | size |
      | 14 | 15 |
    @case:344
    Examples:
      | max | size |
      | 14 | 16 |
    @case:345
    Examples:
      | max | size |
      | 14 | 17 |
    @case:346
    Examples:
      | max | size |
      | 15 | 16 |
    @case:347
    Examples:
      | max | size |
      | 15 | 17 |
    @case:348
    Examples:
      | max | size |
      | 15 | 18 |
    @case:349
    Examples:
      | max | size |
      | 16 | 17 |
    @case:350
    Examples:
      | max | size |
      | 16 | 18 |
    @case:351
    Examples:
      | max | size |
      | 16 | 19 |
    @case:352
    Examples:
      | max | size |
      | 17 | 18 |
    @case:353
    Examples:
      | max | size |
      | 17 | 19 |
    @case:354
    Examples:
      | max | size |
      | 17 | 20 |
    @case:355
    Examples:
      | max | size |
      | 18 | 19 |
    @case:356
    Examples:
      | max | size |
      | 18 | 20 |
    @case:357
    Examples:
      | max | size |
      | 18 | 21 |
    @case:358
    Examples:
      | max | size |
      | 19 | 20 |
    @case:359
    Examples:
      | max | size |
      | 19 | 21 |
    @case:360
    Examples:
      | max | size |
      | 19 | 22 |
    @case:361
    Examples:
      | max | size |
      | 20 | 21 |
    @case:362
    Examples:
      | max | size |
      | 20 | 22 |
    @case:363
    Examples:
      | max | size |
      | 20 | 23 |
    @case:364
    Examples:
      | max | size |
      | 21 | 22 |
    @case:365
    Examples:
      | max | size |
      | 21 | 23 |
    @case:366
    Examples:
      | max | size |
      | 21 | 24 |
    @case:367
    Examples:
      | max | size |
      | 22 | 23 |
    @case:368
    Examples:
      | max | size |
      | 22 | 24 |
    @case:369
    Examples:
      | max | size |
      | 22 | 25 |
    @case:370
    Examples:
      | max | size |
      | 23 | 24 |
    @case:371
    Examples:
      | max | size |
      | 23 | 25 |
    @case:372
    Examples:
      | max | size |
      | 23 | 26 |
    @case:373
    Examples:
      | max | size |
      | 24 | 25 |
    @case:374
    Examples:
      | max | size |
      | 24 | 26 |
    @case:375
    Examples:
      | max | size |
      | 24 | 27 |
    @case:376
    Examples:
      | max | size |
      | 25 | 26 |
    @case:377
    Examples:
      | max | size |
      | 25 | 27 |
    @case:378
    Examples:
      | max | size |
      | 25 | 28 |
    @case:379
    Examples:
      | max | size |
      | 26 | 27 |
    @case:380
    Examples:
      | max | size |
      | 26 | 28 |
    @case:381
    Examples:
      | max | size |
      | 26 | 29 |
    @case:382
    Examples:
      | max | size |
      | 27 | 28 |
    @case:383
    Examples:
      | max | size |
      | 27 | 29 |
    @case:384
    Examples:
      | max | size |
      | 27 | 30 |
    @case:385
    Examples:
      | max | size |
      | 28 | 29 |
    @case:386
    Examples:
      | max | size |
      | 28 | 30 |
    @case:387
    Examples:
      | max | size |
      | 28 | 31 |
    @case:388
    Examples:
      | max | size |
      | 29 | 30 |
    @case:389
    Examples:
      | max | size |
      | 29 | 31 |
    @case:390
    Examples:
      | max | size |
      | 29 | 32 |
    @case:391
    Examples:
      | max | size |
      | 30 | 31 |
    @case:392
    Examples:
      | max | size |
      | 30 | 32 |
    @case:393
    Examples:
      | max | size |
      | 30 | 33 |
    @case:394
    Examples:
      | max | size |
      | 31 | 32 |
    @case:395
    Examples:
      | max | size |
      | 31 | 33 |
    @case:396
    Examples:
      | max | size |
      | 31 | 34 |
    @case:397
    Examples:
      | max | size |
      | 32 | 33 |
    @case:398
    Examples:
      | max | size |
      | 32 | 34 |
    @case:399
    Examples:
      | max | size |
      | 32 | 35 |
    @case:400
    Examples:
      | max | size |
      | 33 | 34 |
    @case:401
    Examples:
      | max | size |
      | 33 | 35 |
    @case:402
    Examples:
      | max | size |
      | 33 | 36 |
    @case:403
    Examples:
      | max | size |
      | 34 | 35 |
    @case:404
    Examples:
      | max | size |
      | 34 | 36 |
    @case:405
    Examples:
      | max | size |
      | 34 | 37 |
    @case:406
    Examples:
      | max | size |
      | 35 | 36 |
    @case:407
    Examples:
      | max | size |
      | 35 | 37 |
    @case:408
    Examples:
      | max | size |
      | 35 | 38 |
    @case:409
    Examples:
      | max | size |
      | 36 | 37 |
    @case:410
    Examples:
      | max | size |
      | 36 | 38 |
    @case:411
    Examples:
      | max | size |
      | 36 | 39 |
    @case:412
    Examples:
      | max | size |
      | 37 | 38 |
    @case:413
    Examples:
      | max | size |
      | 37 | 39 |
    @case:414
    Examples:
      | max | size |
      | 37 | 40 |
    @case:415
    Examples:
      | max | size |
      | 38 | 39 |
    @case:416
    Examples:
      | max | size |
      | 38 | 40 |
    @case:417
    Examples:
      | max | size |
      | 38 | 41 |
    @case:418
    Examples:
      | max | size |
      | 39 | 40 |
    @case:419
    Examples:
      | max | size |
      | 39 | 41 |
    @case:420
    Examples:
      | max | size |
      | 39 | 42 |

  Scenario Outline: With the kill switch engaged a buy of <size> ETH at <price> is refused
    Given a risk-only bot with max order size 100 and max position 100
    And the kill switch is engaged
    When it plans a buy of <size> ETH at <price>
    Then the order is refused with reason "kill-switch"

    @case:421
    Examples:
      | size | price |
      | 1 | 2500.00 |
    @case:422
    Examples:
      | size | price |
      | 1 | 2500.10 |
    @case:423
    Examples:
      | size | price |
      | 1 | 2500.20 |
    @case:424
    Examples:
      | size | price |
      | 1 | 2500.30 |
    @case:425
    Examples:
      | size | price |
      | 1 | 2500.40 |
    @case:426
    Examples:
      | size | price |
      | 1 | 2500.50 |
    @case:427
    Examples:
      | size | price |
      | 1 | 2500.60 |
    @case:428
    Examples:
      | size | price |
      | 1 | 2500.70 |
    @case:429
    Examples:
      | size | price |
      | 1 | 2500.80 |
    @case:430
    Examples:
      | size | price |
      | 1 | 2500.90 |
    @case:431
    Examples:
      | size | price |
      | 2 | 2500.00 |
    @case:432
    Examples:
      | size | price |
      | 2 | 2500.10 |
    @case:433
    Examples:
      | size | price |
      | 2 | 2500.20 |
    @case:434
    Examples:
      | size | price |
      | 2 | 2500.30 |
    @case:435
    Examples:
      | size | price |
      | 2 | 2500.40 |
    @case:436
    Examples:
      | size | price |
      | 2 | 2500.50 |
    @case:437
    Examples:
      | size | price |
      | 2 | 2500.60 |
    @case:438
    Examples:
      | size | price |
      | 2 | 2500.70 |
    @case:439
    Examples:
      | size | price |
      | 2 | 2500.80 |
    @case:440
    Examples:
      | size | price |
      | 2 | 2500.90 |
    @case:441
    Examples:
      | size | price |
      | 3 | 2500.00 |
    @case:442
    Examples:
      | size | price |
      | 3 | 2500.10 |
    @case:443
    Examples:
      | size | price |
      | 3 | 2500.20 |
    @case:444
    Examples:
      | size | price |
      | 3 | 2500.30 |
    @case:445
    Examples:
      | size | price |
      | 3 | 2500.40 |
    @case:446
    Examples:
      | size | price |
      | 3 | 2500.50 |
    @case:447
    Examples:
      | size | price |
      | 3 | 2500.60 |
    @case:448
    Examples:
      | size | price |
      | 3 | 2500.70 |
    @case:449
    Examples:
      | size | price |
      | 3 | 2500.80 |
    @case:450
    Examples:
      | size | price |
      | 3 | 2500.90 |
    @case:451
    Examples:
      | size | price |
      | 4 | 2500.00 |
    @case:452
    Examples:
      | size | price |
      | 4 | 2500.10 |
    @case:453
    Examples:
      | size | price |
      | 4 | 2500.20 |
    @case:454
    Examples:
      | size | price |
      | 4 | 2500.30 |
    @case:455
    Examples:
      | size | price |
      | 4 | 2500.40 |
    @case:456
    Examples:
      | size | price |
      | 4 | 2500.50 |
    @case:457
    Examples:
      | size | price |
      | 4 | 2500.60 |
    @case:458
    Examples:
      | size | price |
      | 4 | 2500.70 |
    @case:459
    Examples:
      | size | price |
      | 4 | 2500.80 |
    @case:460
    Examples:
      | size | price |
      | 4 | 2500.90 |
    @case:461
    Examples:
      | size | price |
      | 5 | 2500.00 |
    @case:462
    Examples:
      | size | price |
      | 5 | 2500.10 |
    @case:463
    Examples:
      | size | price |
      | 5 | 2500.20 |
    @case:464
    Examples:
      | size | price |
      | 5 | 2500.30 |
    @case:465
    Examples:
      | size | price |
      | 5 | 2500.40 |
    @case:466
    Examples:
      | size | price |
      | 5 | 2500.50 |
    @case:467
    Examples:
      | size | price |
      | 5 | 2500.60 |
    @case:468
    Examples:
      | size | price |
      | 5 | 2500.70 |
    @case:469
    Examples:
      | size | price |
      | 5 | 2500.80 |
    @case:470
    Examples:
      | size | price |
      | 5 | 2500.90 |
    @case:471
    Examples:
      | size | price |
      | 6 | 2500.00 |
    @case:472
    Examples:
      | size | price |
      | 6 | 2500.10 |
    @case:473
    Examples:
      | size | price |
      | 6 | 2500.20 |
    @case:474
    Examples:
      | size | price |
      | 6 | 2500.30 |
    @case:475
    Examples:
      | size | price |
      | 6 | 2500.40 |
    @case:476
    Examples:
      | size | price |
      | 6 | 2500.50 |
    @case:477
    Examples:
      | size | price |
      | 6 | 2500.60 |
    @case:478
    Examples:
      | size | price |
      | 6 | 2500.70 |
    @case:479
    Examples:
      | size | price |
      | 6 | 2500.80 |
    @case:480
    Examples:
      | size | price |
      | 6 | 2500.90 |
    @case:481
    Examples:
      | size | price |
      | 7 | 2500.00 |
    @case:482
    Examples:
      | size | price |
      | 7 | 2500.10 |
    @case:483
    Examples:
      | size | price |
      | 7 | 2500.20 |
    @case:484
    Examples:
      | size | price |
      | 7 | 2500.30 |
    @case:485
    Examples:
      | size | price |
      | 7 | 2500.40 |
    @case:486
    Examples:
      | size | price |
      | 7 | 2500.50 |
    @case:487
    Examples:
      | size | price |
      | 7 | 2500.60 |
    @case:488
    Examples:
      | size | price |
      | 7 | 2500.70 |
    @case:489
    Examples:
      | size | price |
      | 7 | 2500.80 |
    @case:490
    Examples:
      | size | price |
      | 7 | 2500.90 |
    @case:491
    Examples:
      | size | price |
      | 8 | 2500.00 |
    @case:492
    Examples:
      | size | price |
      | 8 | 2500.10 |
    @case:493
    Examples:
      | size | price |
      | 8 | 2500.20 |
    @case:494
    Examples:
      | size | price |
      | 8 | 2500.30 |
    @case:495
    Examples:
      | size | price |
      | 8 | 2500.40 |
    @case:496
    Examples:
      | size | price |
      | 8 | 2500.50 |
    @case:497
    Examples:
      | size | price |
      | 8 | 2500.60 |
    @case:498
    Examples:
      | size | price |
      | 8 | 2500.70 |
    @case:499
    Examples:
      | size | price |
      | 8 | 2500.80 |
    @case:500
    Examples:
      | size | price |
      | 8 | 2500.90 |
    @case:501
    Examples:
      | size | price |
      | 9 | 2500.00 |
    @case:502
    Examples:
      | size | price |
      | 9 | 2500.10 |
    @case:503
    Examples:
      | size | price |
      | 9 | 2500.20 |
    @case:504
    Examples:
      | size | price |
      | 9 | 2500.30 |
    @case:505
    Examples:
      | size | price |
      | 9 | 2500.40 |
    @case:506
    Examples:
      | size | price |
      | 9 | 2500.50 |
    @case:507
    Examples:
      | size | price |
      | 9 | 2500.60 |
    @case:508
    Examples:
      | size | price |
      | 9 | 2500.70 |
    @case:509
    Examples:
      | size | price |
      | 9 | 2500.80 |
    @case:510
    Examples:
      | size | price |
      | 9 | 2500.90 |
    @case:511
    Examples:
      | size | price |
      | 10 | 2500.00 |
    @case:512
    Examples:
      | size | price |
      | 10 | 2500.10 |
    @case:513
    Examples:
      | size | price |
      | 10 | 2500.20 |
    @case:514
    Examples:
      | size | price |
      | 10 | 2500.30 |
    @case:515
    Examples:
      | size | price |
      | 10 | 2500.40 |
    @case:516
    Examples:
      | size | price |
      | 10 | 2500.50 |
    @case:517
    Examples:
      | size | price |
      | 10 | 2500.60 |
    @case:518
    Examples:
      | size | price |
      | 10 | 2500.70 |
    @case:519
    Examples:
      | size | price |
      | 10 | 2500.80 |
    @case:520
    Examples:
      | size | price |
      | 10 | 2500.90 |

  Scenario Outline: A buy of <size> ETH onto a position of <pos> breaches max position <maxpos>
    Given a risk-only bot with max order size 1000000 and max position <maxpos>
    When it plans a buy of <size> ETH at 2500 against an existing position of <pos> ETH
    Then the order is refused with reason "max-position"

    @case:521
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 2 |
    @case:522
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 3 |
    @case:523
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 4 |
    @case:524
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 5 |
    @case:525
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 6 |
    @case:526
    Examples:
      | maxpos | pos | size |
      | 5 | 4 | 7 |
    @case:527
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 2 |
    @case:528
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 3 |
    @case:529
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 4 |
    @case:530
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 5 |
    @case:531
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 6 |
    @case:532
    Examples:
      | maxpos | pos | size |
      | 6 | 5 | 7 |
    @case:533
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 2 |
    @case:534
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 3 |
    @case:535
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 4 |
    @case:536
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 5 |
    @case:537
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 6 |
    @case:538
    Examples:
      | maxpos | pos | size |
      | 7 | 6 | 7 |
    @case:539
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 2 |
    @case:540
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 3 |
    @case:541
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 4 |
    @case:542
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 5 |
    @case:543
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 6 |
    @case:544
    Examples:
      | maxpos | pos | size |
      | 8 | 7 | 7 |
    @case:545
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 2 |
    @case:546
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 3 |
    @case:547
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 4 |
    @case:548
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 5 |
    @case:549
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 6 |
    @case:550
    Examples:
      | maxpos | pos | size |
      | 9 | 8 | 7 |
    @case:551
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 2 |
    @case:552
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 3 |
    @case:553
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 4 |
    @case:554
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 5 |
    @case:555
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 6 |
    @case:556
    Examples:
      | maxpos | pos | size |
      | 10 | 9 | 7 |
    @case:557
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 2 |
    @case:558
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 3 |
    @case:559
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 4 |
    @case:560
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 5 |
    @case:561
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 6 |
    @case:562
    Examples:
      | maxpos | pos | size |
      | 11 | 10 | 7 |
    @case:563
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 2 |
    @case:564
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 3 |
    @case:565
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 4 |
    @case:566
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 5 |
    @case:567
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 6 |
    @case:568
    Examples:
      | maxpos | pos | size |
      | 12 | 11 | 7 |
    @case:569
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 2 |
    @case:570
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 3 |
    @case:571
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 4 |
    @case:572
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 5 |
    @case:573
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 6 |
    @case:574
    Examples:
      | maxpos | pos | size |
      | 13 | 12 | 7 |
    @case:575
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 2 |
    @case:576
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 3 |
    @case:577
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 4 |
    @case:578
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 5 |
    @case:579
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 6 |
    @case:580
    Examples:
      | maxpos | pos | size |
      | 14 | 13 | 7 |
    @case:581
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 2 |
    @case:582
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 3 |
    @case:583
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 4 |
    @case:584
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 5 |
    @case:585
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 6 |
    @case:586
    Examples:
      | maxpos | pos | size |
      | 15 | 14 | 7 |
    @case:587
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 2 |
    @case:588
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 3 |
    @case:589
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 4 |
    @case:590
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 5 |
    @case:591
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 6 |
    @case:592
    Examples:
      | maxpos | pos | size |
      | 16 | 15 | 7 |
    @case:593
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 2 |
    @case:594
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 3 |
    @case:595
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 4 |
    @case:596
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 5 |
    @case:597
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 6 |
    @case:598
    Examples:
      | maxpos | pos | size |
      | 17 | 16 | 7 |
    @case:599
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 2 |
    @case:600
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 3 |
    @case:601
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 4 |
    @case:602
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 5 |
    @case:603
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 6 |
    @case:604
    Examples:
      | maxpos | pos | size |
      | 18 | 17 | 7 |
    @case:605
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 2 |
    @case:606
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 3 |
    @case:607
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 4 |
    @case:608
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 5 |
    @case:609
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 6 |
    @case:610
    Examples:
      | maxpos | pos | size |
      | 19 | 18 | 7 |
    @case:611
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 2 |
    @case:612
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 3 |
    @case:613
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 4 |
    @case:614
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 5 |
    @case:615
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 6 |
    @case:616
    Examples:
      | maxpos | pos | size |
      | 20 | 19 | 7 |
    @case:617
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 2 |
    @case:618
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 3 |
    @case:619
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 4 |
    @case:620
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 5 |
    @case:621
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 6 |
    @case:622
    Examples:
      | maxpos | pos | size |
      | 21 | 20 | 7 |
    @case:623
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 2 |
    @case:624
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 3 |
    @case:625
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 4 |
    @case:626
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 5 |
    @case:627
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 6 |
    @case:628
    Examples:
      | maxpos | pos | size |
      | 22 | 21 | 7 |
    @case:629
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 2 |
    @case:630
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 3 |
    @case:631
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 4 |
    @case:632
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 5 |
    @case:633
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 6 |
    @case:634
    Examples:
      | maxpos | pos | size |
      | 23 | 22 | 7 |
    @case:635
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 2 |
    @case:636
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 3 |
    @case:637
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 4 |
    @case:638
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 5 |
    @case:639
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 6 |
    @case:640
    Examples:
      | maxpos | pos | size |
      | 24 | 23 | 7 |

  Scenario Outline: A reduce-only sell of <size> ETH onto a position of <pos> clears past the cap
    Given a risk-only bot with max order size 1000000 and max position 1
    When it plans a reduce-only sell of <size> ETH at 2500 against an existing position of <pos> ETH
    Then the order is cleared to send

    @case:641
    Examples:
      | pos | size |
      | 2 | 1 |
    @case:642
    Examples:
      | pos | size |
      | 2 | 2 |
    @case:643
    Examples:
      | pos | size |
      | 2 | 3 |
    @case:644
    Examples:
      | pos | size |
      | 2 | 4 |
    @case:645
    Examples:
      | pos | size |
      | 2 | 5 |
    @case:646
    Examples:
      | pos | size |
      | 3 | 1 |
    @case:647
    Examples:
      | pos | size |
      | 3 | 2 |
    @case:648
    Examples:
      | pos | size |
      | 3 | 3 |
    @case:649
    Examples:
      | pos | size |
      | 3 | 4 |
    @case:650
    Examples:
      | pos | size |
      | 3 | 5 |
    @case:651
    Examples:
      | pos | size |
      | 4 | 1 |
    @case:652
    Examples:
      | pos | size |
      | 4 | 2 |
    @case:653
    Examples:
      | pos | size |
      | 4 | 3 |
    @case:654
    Examples:
      | pos | size |
      | 4 | 4 |
    @case:655
    Examples:
      | pos | size |
      | 4 | 5 |
    @case:656
    Examples:
      | pos | size |
      | 5 | 1 |
    @case:657
    Examples:
      | pos | size |
      | 5 | 2 |
    @case:658
    Examples:
      | pos | size |
      | 5 | 3 |
    @case:659
    Examples:
      | pos | size |
      | 5 | 4 |
    @case:660
    Examples:
      | pos | size |
      | 5 | 5 |
    @case:661
    Examples:
      | pos | size |
      | 6 | 1 |
    @case:662
    Examples:
      | pos | size |
      | 6 | 2 |
    @case:663
    Examples:
      | pos | size |
      | 6 | 3 |
    @case:664
    Examples:
      | pos | size |
      | 6 | 4 |
    @case:665
    Examples:
      | pos | size |
      | 6 | 5 |
    @case:666
    Examples:
      | pos | size |
      | 7 | 1 |
    @case:667
    Examples:
      | pos | size |
      | 7 | 2 |
    @case:668
    Examples:
      | pos | size |
      | 7 | 3 |
    @case:669
    Examples:
      | pos | size |
      | 7 | 4 |
    @case:670
    Examples:
      | pos | size |
      | 7 | 5 |
    @case:671
    Examples:
      | pos | size |
      | 8 | 1 |
    @case:672
    Examples:
      | pos | size |
      | 8 | 2 |
    @case:673
    Examples:
      | pos | size |
      | 8 | 3 |
    @case:674
    Examples:
      | pos | size |
      | 8 | 4 |
    @case:675
    Examples:
      | pos | size |
      | 8 | 5 |
    @case:676
    Examples:
      | pos | size |
      | 9 | 1 |
    @case:677
    Examples:
      | pos | size |
      | 9 | 2 |
    @case:678
    Examples:
      | pos | size |
      | 9 | 3 |
    @case:679
    Examples:
      | pos | size |
      | 9 | 4 |
    @case:680
    Examples:
      | pos | size |
      | 9 | 5 |
    @case:681
    Examples:
      | pos | size |
      | 10 | 1 |
    @case:682
    Examples:
      | pos | size |
      | 10 | 2 |
    @case:683
    Examples:
      | pos | size |
      | 10 | 3 |
    @case:684
    Examples:
      | pos | size |
      | 10 | 4 |
    @case:685
    Examples:
      | pos | size |
      | 10 | 5 |
    @case:686
    Examples:
      | pos | size |
      | 11 | 1 |
    @case:687
    Examples:
      | pos | size |
      | 11 | 2 |
    @case:688
    Examples:
      | pos | size |
      | 11 | 3 |
    @case:689
    Examples:
      | pos | size |
      | 11 | 4 |
    @case:690
    Examples:
      | pos | size |
      | 11 | 5 |
    @case:691
    Examples:
      | pos | size |
      | 12 | 1 |
    @case:692
    Examples:
      | pos | size |
      | 12 | 2 |
    @case:693
    Examples:
      | pos | size |
      | 12 | 3 |
    @case:694
    Examples:
      | pos | size |
      | 12 | 4 |
    @case:695
    Examples:
      | pos | size |
      | 12 | 5 |
    @case:696
    Examples:
      | pos | size |
      | 13 | 1 |
    @case:697
    Examples:
      | pos | size |
      | 13 | 2 |
    @case:698
    Examples:
      | pos | size |
      | 13 | 3 |
    @case:699
    Examples:
      | pos | size |
      | 13 | 4 |
    @case:700
    Examples:
      | pos | size |
      | 13 | 5 |
    @case:701
    Examples:
      | pos | size |
      | 14 | 1 |
    @case:702
    Examples:
      | pos | size |
      | 14 | 2 |
    @case:703
    Examples:
      | pos | size |
      | 14 | 3 |
    @case:704
    Examples:
      | pos | size |
      | 14 | 4 |
    @case:705
    Examples:
      | pos | size |
      | 14 | 5 |
    @case:706
    Examples:
      | pos | size |
      | 15 | 1 |
    @case:707
    Examples:
      | pos | size |
      | 15 | 2 |
    @case:708
    Examples:
      | pos | size |
      | 15 | 3 |
    @case:709
    Examples:
      | pos | size |
      | 15 | 4 |
    @case:710
    Examples:
      | pos | size |
      | 15 | 5 |
    @case:711
    Examples:
      | pos | size |
      | 16 | 1 |
    @case:712
    Examples:
      | pos | size |
      | 16 | 2 |
    @case:713
    Examples:
      | pos | size |
      | 16 | 3 |
    @case:714
    Examples:
      | pos | size |
      | 16 | 4 |
    @case:715
    Examples:
      | pos | size |
      | 16 | 5 |
    @case:716
    Examples:
      | pos | size |
      | 17 | 1 |
    @case:717
    Examples:
      | pos | size |
      | 17 | 2 |
    @case:718
    Examples:
      | pos | size |
      | 17 | 3 |
    @case:719
    Examples:
      | pos | size |
      | 17 | 4 |
    @case:720
    Examples:
      | pos | size |
      | 17 | 5 |
    @case:721
    Examples:
      | pos | size |
      | 18 | 1 |
    @case:722
    Examples:
      | pos | size |
      | 18 | 2 |
    @case:723
    Examples:
      | pos | size |
      | 18 | 3 |
    @case:724
    Examples:
      | pos | size |
      | 18 | 4 |
    @case:725
    Examples:
      | pos | size |
      | 18 | 5 |
    @case:726
    Examples:
      | pos | size |
      | 19 | 1 |
    @case:727
    Examples:
      | pos | size |
      | 19 | 2 |
    @case:728
    Examples:
      | pos | size |
      | 19 | 3 |
    @case:729
    Examples:
      | pos | size |
      | 19 | 4 |
    @case:730
    Examples:
      | pos | size |
      | 19 | 5 |
    @case:731
    Examples:
      | pos | size |
      | 20 | 1 |
    @case:732
    Examples:
      | pos | size |
      | 20 | 2 |
    @case:733
    Examples:
      | pos | size |
      | 20 | 3 |
    @case:734
    Examples:
      | pos | size |
      | 20 | 4 |
    @case:735
    Examples:
      | pos | size |
      | 20 | 5 |
    @case:736
    Examples:
      | pos | size |
      | 21 | 1 |
    @case:737
    Examples:
      | pos | size |
      | 21 | 2 |
    @case:738
    Examples:
      | pos | size |
      | 21 | 3 |
    @case:739
    Examples:
      | pos | size |
      | 21 | 4 |
    @case:740
    Examples:
      | pos | size |
      | 21 | 5 |

  Scenario Outline: A valid buy of <size> ETH at <price> clears to send
    Given a risk-only bot with max order size 1000000 and max position 1000000
    When it plans a buy of <size> ETH at <price>
    Then the order is cleared to send

    @case:741
    Examples:
      | size | price |
      | 1 | 2500.00 |
    @case:742
    Examples:
      | size | price |
      | 1 | 2501.00 |
    @case:743
    Examples:
      | size | price |
      | 1 | 2502.00 |
    @case:744
    Examples:
      | size | price |
      | 1 | 2503.00 |
    @case:745
    Examples:
      | size | price |
      | 1 | 2504.00 |
    @case:746
    Examples:
      | size | price |
      | 1 | 2505.00 |
    @case:747
    Examples:
      | size | price |
      | 1 | 2506.00 |
    @case:748
    Examples:
      | size | price |
      | 1 | 2507.00 |
    @case:749
    Examples:
      | size | price |
      | 1 | 2508.00 |
    @case:750
    Examples:
      | size | price |
      | 1 | 2509.00 |
    @case:751
    Examples:
      | size | price |
      | 2 | 2500.00 |
    @case:752
    Examples:
      | size | price |
      | 2 | 2501.00 |
    @case:753
    Examples:
      | size | price |
      | 2 | 2502.00 |
    @case:754
    Examples:
      | size | price |
      | 2 | 2503.00 |
    @case:755
    Examples:
      | size | price |
      | 2 | 2504.00 |
    @case:756
    Examples:
      | size | price |
      | 2 | 2505.00 |
    @case:757
    Examples:
      | size | price |
      | 2 | 2506.00 |
    @case:758
    Examples:
      | size | price |
      | 2 | 2507.00 |
    @case:759
    Examples:
      | size | price |
      | 2 | 2508.00 |
    @case:760
    Examples:
      | size | price |
      | 2 | 2509.00 |
    @case:761
    Examples:
      | size | price |
      | 3 | 2500.00 |
    @case:762
    Examples:
      | size | price |
      | 3 | 2501.00 |
    @case:763
    Examples:
      | size | price |
      | 3 | 2502.00 |
    @case:764
    Examples:
      | size | price |
      | 3 | 2503.00 |
    @case:765
    Examples:
      | size | price |
      | 3 | 2504.00 |
    @case:766
    Examples:
      | size | price |
      | 3 | 2505.00 |
    @case:767
    Examples:
      | size | price |
      | 3 | 2506.00 |
    @case:768
    Examples:
      | size | price |
      | 3 | 2507.00 |
    @case:769
    Examples:
      | size | price |
      | 3 | 2508.00 |
    @case:770
    Examples:
      | size | price |
      | 3 | 2509.00 |
    @case:771
    Examples:
      | size | price |
      | 4 | 2500.00 |
    @case:772
    Examples:
      | size | price |
      | 4 | 2501.00 |
    @case:773
    Examples:
      | size | price |
      | 4 | 2502.00 |
    @case:774
    Examples:
      | size | price |
      | 4 | 2503.00 |
    @case:775
    Examples:
      | size | price |
      | 4 | 2504.00 |
    @case:776
    Examples:
      | size | price |
      | 4 | 2505.00 |
    @case:777
    Examples:
      | size | price |
      | 4 | 2506.00 |
    @case:778
    Examples:
      | size | price |
      | 4 | 2507.00 |
    @case:779
    Examples:
      | size | price |
      | 4 | 2508.00 |
    @case:780
    Examples:
      | size | price |
      | 4 | 2509.00 |
    @case:781
    Examples:
      | size | price |
      | 5 | 2500.00 |
    @case:782
    Examples:
      | size | price |
      | 5 | 2501.00 |
    @case:783
    Examples:
      | size | price |
      | 5 | 2502.00 |
    @case:784
    Examples:
      | size | price |
      | 5 | 2503.00 |
    @case:785
    Examples:
      | size | price |
      | 5 | 2504.00 |
    @case:786
    Examples:
      | size | price |
      | 5 | 2505.00 |
    @case:787
    Examples:
      | size | price |
      | 5 | 2506.00 |
    @case:788
    Examples:
      | size | price |
      | 5 | 2507.00 |
    @case:789
    Examples:
      | size | price |
      | 5 | 2508.00 |
    @case:790
    Examples:
      | size | price |
      | 5 | 2509.00 |
    @case:791
    Examples:
      | size | price |
      | 6 | 2500.00 |
    @case:792
    Examples:
      | size | price |
      | 6 | 2501.00 |
    @case:793
    Examples:
      | size | price |
      | 6 | 2502.00 |
    @case:794
    Examples:
      | size | price |
      | 6 | 2503.00 |
    @case:795
    Examples:
      | size | price |
      | 6 | 2504.00 |
    @case:796
    Examples:
      | size | price |
      | 6 | 2505.00 |
    @case:797
    Examples:
      | size | price |
      | 6 | 2506.00 |
    @case:798
    Examples:
      | size | price |
      | 6 | 2507.00 |
    @case:799
    Examples:
      | size | price |
      | 6 | 2508.00 |
    @case:800
    Examples:
      | size | price |
      | 6 | 2509.00 |
    @case:801
    Examples:
      | size | price |
      | 7 | 2500.00 |
    @case:802
    Examples:
      | size | price |
      | 7 | 2501.00 |
    @case:803
    Examples:
      | size | price |
      | 7 | 2502.00 |
    @case:804
    Examples:
      | size | price |
      | 7 | 2503.00 |
    @case:805
    Examples:
      | size | price |
      | 7 | 2504.00 |
    @case:806
    Examples:
      | size | price |
      | 7 | 2505.00 |
    @case:807
    Examples:
      | size | price |
      | 7 | 2506.00 |
    @case:808
    Examples:
      | size | price |
      | 7 | 2507.00 |
    @case:809
    Examples:
      | size | price |
      | 7 | 2508.00 |
    @case:810
    Examples:
      | size | price |
      | 7 | 2509.00 |
    @case:811
    Examples:
      | size | price |
      | 8 | 2500.00 |
    @case:812
    Examples:
      | size | price |
      | 8 | 2501.00 |
    @case:813
    Examples:
      | size | price |
      | 8 | 2502.00 |
    @case:814
    Examples:
      | size | price |
      | 8 | 2503.00 |
    @case:815
    Examples:
      | size | price |
      | 8 | 2504.00 |
    @case:816
    Examples:
      | size | price |
      | 8 | 2505.00 |
    @case:817
    Examples:
      | size | price |
      | 8 | 2506.00 |
    @case:818
    Examples:
      | size | price |
      | 8 | 2507.00 |
    @case:819
    Examples:
      | size | price |
      | 8 | 2508.00 |
    @case:820
    Examples:
      | size | price |
      | 8 | 2509.00 |
    @case:821
    Examples:
      | size | price |
      | 9 | 2500.00 |
    @case:822
    Examples:
      | size | price |
      | 9 | 2501.00 |
    @case:823
    Examples:
      | size | price |
      | 9 | 2502.00 |
    @case:824
    Examples:
      | size | price |
      | 9 | 2503.00 |
    @case:825
    Examples:
      | size | price |
      | 9 | 2504.00 |
    @case:826
    Examples:
      | size | price |
      | 9 | 2505.00 |
    @case:827
    Examples:
      | size | price |
      | 9 | 2506.00 |
    @case:828
    Examples:
      | size | price |
      | 9 | 2507.00 |
    @case:829
    Examples:
      | size | price |
      | 9 | 2508.00 |
    @case:830
    Examples:
      | size | price |
      | 9 | 2509.00 |
    @case:831
    Examples:
      | size | price |
      | 10 | 2500.00 |
    @case:832
    Examples:
      | size | price |
      | 10 | 2501.00 |
    @case:833
    Examples:
      | size | price |
      | 10 | 2502.00 |
    @case:834
    Examples:
      | size | price |
      | 10 | 2503.00 |
    @case:835
    Examples:
      | size | price |
      | 10 | 2504.00 |
    @case:836
    Examples:
      | size | price |
      | 10 | 2505.00 |
    @case:837
    Examples:
      | size | price |
      | 10 | 2506.00 |
    @case:838
    Examples:
      | size | price |
      | 10 | 2507.00 |
    @case:839
    Examples:
      | size | price |
      | 10 | 2508.00 |
    @case:840
    Examples:
      | size | price |
      | 10 | 2509.00 |

  Scenario Outline: Under dry run a buy of <size> ETH at <price> is planned but not sent
    Given a risk-only bot with max order size 1000000 and max position 1000000
    And dry run is engaged
    When it plans a buy of <size> ETH at <price>
    Then the order is cleared as a dry run

    @case:841
    Examples:
      | size | price |
      | 1 | 2500.00 |
    @case:842
    Examples:
      | size | price |
      | 1 | 2501.00 |
    @case:843
    Examples:
      | size | price |
      | 1 | 2502.00 |
    @case:844
    Examples:
      | size | price |
      | 1 | 2503.00 |
    @case:845
    Examples:
      | size | price |
      | 1 | 2504.00 |
    @case:846
    Examples:
      | size | price |
      | 1 | 2505.00 |
    @case:847
    Examples:
      | size | price |
      | 1 | 2506.00 |
    @case:848
    Examples:
      | size | price |
      | 1 | 2507.00 |
    @case:849
    Examples:
      | size | price |
      | 1 | 2508.00 |
    @case:850
    Examples:
      | size | price |
      | 1 | 2509.00 |
    @case:851
    Examples:
      | size | price |
      | 2 | 2500.00 |
    @case:852
    Examples:
      | size | price |
      | 2 | 2501.00 |
    @case:853
    Examples:
      | size | price |
      | 2 | 2502.00 |
    @case:854
    Examples:
      | size | price |
      | 2 | 2503.00 |
    @case:855
    Examples:
      | size | price |
      | 2 | 2504.00 |
    @case:856
    Examples:
      | size | price |
      | 2 | 2505.00 |
    @case:857
    Examples:
      | size | price |
      | 2 | 2506.00 |
    @case:858
    Examples:
      | size | price |
      | 2 | 2507.00 |
    @case:859
    Examples:
      | size | price |
      | 2 | 2508.00 |
    @case:860
    Examples:
      | size | price |
      | 2 | 2509.00 |
    @case:861
    Examples:
      | size | price |
      | 3 | 2500.00 |
    @case:862
    Examples:
      | size | price |
      | 3 | 2501.00 |
    @case:863
    Examples:
      | size | price |
      | 3 | 2502.00 |
    @case:864
    Examples:
      | size | price |
      | 3 | 2503.00 |
    @case:865
    Examples:
      | size | price |
      | 3 | 2504.00 |
    @case:866
    Examples:
      | size | price |
      | 3 | 2505.00 |
    @case:867
    Examples:
      | size | price |
      | 3 | 2506.00 |
    @case:868
    Examples:
      | size | price |
      | 3 | 2507.00 |
    @case:869
    Examples:
      | size | price |
      | 3 | 2508.00 |
    @case:870
    Examples:
      | size | price |
      | 3 | 2509.00 |
    @case:871
    Examples:
      | size | price |
      | 4 | 2500.00 |
    @case:872
    Examples:
      | size | price |
      | 4 | 2501.00 |
    @case:873
    Examples:
      | size | price |
      | 4 | 2502.00 |
    @case:874
    Examples:
      | size | price |
      | 4 | 2503.00 |
    @case:875
    Examples:
      | size | price |
      | 4 | 2504.00 |
    @case:876
    Examples:
      | size | price |
      | 4 | 2505.00 |
    @case:877
    Examples:
      | size | price |
      | 4 | 2506.00 |
    @case:878
    Examples:
      | size | price |
      | 4 | 2507.00 |
    @case:879
    Examples:
      | size | price |
      | 4 | 2508.00 |
    @case:880
    Examples:
      | size | price |
      | 4 | 2509.00 |
    @case:881
    Examples:
      | size | price |
      | 5 | 2500.00 |
    @case:882
    Examples:
      | size | price |
      | 5 | 2501.00 |
    @case:883
    Examples:
      | size | price |
      | 5 | 2502.00 |
    @case:884
    Examples:
      | size | price |
      | 5 | 2503.00 |
    @case:885
    Examples:
      | size | price |
      | 5 | 2504.00 |
    @case:886
    Examples:
      | size | price |
      | 5 | 2505.00 |
    @case:887
    Examples:
      | size | price |
      | 5 | 2506.00 |
    @case:888
    Examples:
      | size | price |
      | 5 | 2507.00 |
    @case:889
    Examples:
      | size | price |
      | 5 | 2508.00 |
    @case:890
    Examples:
      | size | price |
      | 5 | 2509.00 |
    @case:891
    Examples:
      | size | price |
      | 6 | 2500.00 |
    @case:892
    Examples:
      | size | price |
      | 6 | 2501.00 |
    @case:893
    Examples:
      | size | price |
      | 6 | 2502.00 |
    @case:894
    Examples:
      | size | price |
      | 6 | 2503.00 |
    @case:895
    Examples:
      | size | price |
      | 6 | 2504.00 |
    @case:896
    Examples:
      | size | price |
      | 6 | 2505.00 |
    @case:897
    Examples:
      | size | price |
      | 6 | 2506.00 |
    @case:898
    Examples:
      | size | price |
      | 6 | 2507.00 |
    @case:899
    Examples:
      | size | price |
      | 6 | 2508.00 |
    @case:900
    Examples:
      | size | price |
      | 6 | 2509.00 |
    @case:901
    Examples:
      | size | price |
      | 7 | 2500.00 |
    @case:902
    Examples:
      | size | price |
      | 7 | 2501.00 |
    @case:903
    Examples:
      | size | price |
      | 7 | 2502.00 |
    @case:904
    Examples:
      | size | price |
      | 7 | 2503.00 |
    @case:905
    Examples:
      | size | price |
      | 7 | 2504.00 |
    @case:906
    Examples:
      | size | price |
      | 7 | 2505.00 |
    @case:907
    Examples:
      | size | price |
      | 7 | 2506.00 |
    @case:908
    Examples:
      | size | price |
      | 7 | 2507.00 |
    @case:909
    Examples:
      | size | price |
      | 7 | 2508.00 |
    @case:910
    Examples:
      | size | price |
      | 7 | 2509.00 |
    @case:911
    Examples:
      | size | price |
      | 8 | 2500.00 |
    @case:912
    Examples:
      | size | price |
      | 8 | 2501.00 |
    @case:913
    Examples:
      | size | price |
      | 8 | 2502.00 |
    @case:914
    Examples:
      | size | price |
      | 8 | 2503.00 |
    @case:915
    Examples:
      | size | price |
      | 8 | 2504.00 |
    @case:916
    Examples:
      | size | price |
      | 8 | 2505.00 |
    @case:917
    Examples:
      | size | price |
      | 8 | 2506.00 |
    @case:918
    Examples:
      | size | price |
      | 8 | 2507.00 |
    @case:919
    Examples:
      | size | price |
      | 8 | 2508.00 |
    @case:920
    Examples:
      | size | price |
      | 8 | 2509.00 |

  Scenario Outline: A <size> <sym> order rounds to zero at the step and is refused
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of <size> <sym> at 2500
    Then the order is refused with reason "zero-size"

    @case:921
    Examples:
      | sym | size |
      | ETH | 0.0001 |
    @case:922
    Examples:
      | sym | size |
      | ETH | 0.0002 |
    @case:923
    Examples:
      | sym | size |
      | ETH | 0.0003 |
    @case:924
    Examples:
      | sym | size |
      | ETH | 0.0004 |
    @case:925
    Examples:
      | sym | size |
      | ETH | 0.0005 |
    @case:926
    Examples:
      | sym | size |
      | ETH | 0.0006 |
    @case:927
    Examples:
      | sym | size |
      | ETH | 0.0007 |
    @case:928
    Examples:
      | sym | size |
      | ETH | 0.0008 |
    @case:929
    Examples:
      | sym | size |
      | ETH | 0.0009 |
    @case:930
    Examples:
      | sym | size |
      | SOL | 0.001 |
    @case:931
    Examples:
      | sym | size |
      | SOL | 0.002 |
    @case:932
    Examples:
      | sym | size |
      | SOL | 0.003 |
    @case:933
    Examples:
      | sym | size |
      | SOL | 0.004 |
    @case:934
    Examples:
      | sym | size |
      | SOL | 0.005 |
    @case:935
    Examples:
      | sym | size |
      | SOL | 0.006 |
    @case:936
    Examples:
      | sym | size |
      | SOL | 0.007 |
    @case:937
    Examples:
      | sym | size |
      | SOL | 0.008 |
    @case:938
    Examples:
      | sym | size |
      | SOL | 0.009 |

  Scenario Outline: A buy of <size> ETH at <price> is under the minimum notional
    Given a risk-only bot with max order size 1000000 and max position 1000000
    When it plans a buy of <size> ETH at <price>
    Then the order is refused with reason "below-min-notional"

    @case:939
    Examples:
      | size | price |
      | 0.001 | 100 |
    @case:940
    Examples:
      | size | price |
      | 0.001 | 200 |
    @case:941
    Examples:
      | size | price |
      | 0.001 | 300 |
    @case:942
    Examples:
      | size | price |
      | 0.001 | 400 |
    @case:943
    Examples:
      | size | price |
      | 0.001 | 500 |
    @case:944
    Examples:
      | size | price |
      | 0.001 | 600 |
    @case:945
    Examples:
      | size | price |
      | 0.001 | 700 |
    @case:946
    Examples:
      | size | price |
      | 0.001 | 800 |
    @case:947
    Examples:
      | size | price |
      | 0.001 | 900 |
    @case:948
    Examples:
      | size | price |
      | 0.001 | 1000 |
    @case:949
    Examples:
      | size | price |
      | 0.001 | 1100 |
    @case:950
    Examples:
      | size | price |
      | 0.001 | 1200 |
    @case:951
    Examples:
      | size | price |
      | 0.001 | 1300 |
    @case:952
    Examples:
      | size | price |
      | 0.001 | 1400 |
    @case:953
    Examples:
      | size | price |
      | 0.001 | 1500 |
    @case:954
    Examples:
      | size | price |
      | 0.001 | 1600 |
    @case:955
    Examples:
      | size | price |
      | 0.001 | 1700 |
    @case:956
    Examples:
      | size | price |
      | 0.001 | 1800 |
    @case:957
    Examples:
      | size | price |
      | 0.001 | 1900 |
    @case:958
    Examples:
      | size | price |
      | 0.001 | 2000 |
    @case:959
    Examples:
      | size | price |
      | 0.001 | 2100 |
    @case:960
    Examples:
      | size | price |
      | 0.001 | 2200 |
    @case:961
    Examples:
      | size | price |
      | 0.001 | 2300 |
    @case:962
    Examples:
      | size | price |
      | 0.001 | 2400 |
    @case:963
    Examples:
      | size | price |
      | 0.001 | 2500 |
    @case:964
    Examples:
      | size | price |
      | 0.001 | 2600 |
    @case:965
    Examples:
      | size | price |
      | 0.001 | 2700 |
    @case:966
    Examples:
      | size | price |
      | 0.001 | 2800 |
    @case:967
    Examples:
      | size | price |
      | 0.001 | 2900 |
    @case:968
    Examples:
      | size | price |
      | 0.001 | 3000 |
    @case:969
    Examples:
      | size | price |
      | 0.001 | 3100 |
    @case:970
    Examples:
      | size | price |
      | 0.001 | 3200 |
    @case:971
    Examples:
      | size | price |
      | 0.001 | 3300 |
    @case:972
    Examples:
      | size | price |
      | 0.001 | 3400 |
    @case:973
    Examples:
      | size | price |
      | 0.001 | 3500 |
    @case:974
    Examples:
      | size | price |
      | 0.001 | 3600 |
    @case:975
    Examples:
      | size | price |
      | 0.001 | 3700 |
    @case:976
    Examples:
      | size | price |
      | 0.001 | 3800 |
    @case:977
    Examples:
      | size | price |
      | 0.001 | 3900 |
    @case:978
    Examples:
      | size | price |
      | 0.001 | 4000 |
    @case:979
    Examples:
      | size | price |
      | 0.001 | 4100 |
    @case:980
    Examples:
      | size | price |
      | 0.001 | 4200 |
    @case:981
    Examples:
      | size | price |
      | 0.001 | 4300 |
    @case:982
    Examples:
      | size | price |
      | 0.001 | 4400 |
    @case:983
    Examples:
      | size | price |
      | 0.001 | 4500 |
    @case:984
    Examples:
      | size | price |
      | 0.001 | 4600 |
    @case:985
    Examples:
      | size | price |
      | 0.001 | 4700 |
    @case:986
    Examples:
      | size | price |
      | 0.001 | 4800 |
    @case:987
    Examples:
      | size | price |
      | 0.001 | 4900 |
    @case:988
    Examples:
      | size | price |
      | 0.001 | 5000 |
    @case:989
    Examples:
      | size | price |
      | 0.001 | 5100 |
    @case:990
    Examples:
      | size | price |
      | 0.001 | 5200 |
    @case:991
    Examples:
      | size | price |
      | 0.001 | 5300 |
    @case:992
    Examples:
      | size | price |
      | 0.001 | 5400 |
    @case:993
    Examples:
      | size | price |
      | 0.001 | 5500 |
    @case:994
    Examples:
      | size | price |
      | 0.001 | 5600 |
    @case:995
    Examples:
      | size | price |
      | 0.001 | 5700 |
    @case:996
    Examples:
      | size | price |
      | 0.001 | 5800 |
    @case:997
    Examples:
      | size | price |
      | 0.001 | 5900 |
    @case:998
    Examples:
      | size | price |
      | 0.001 | 6000 |
    @case:999
    Examples:
      | size | price |
      | 0.001 | 6100 |
    @case:1000
    Examples:
      | size | price |
      | 0.001 | 6200 |


  @case:238 @perpdex
  Scenario: A post-only order that would cross is surfaced, not retried
    Given a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And a bot funded with $100000
    When the bot places a post-only buy of 1 ETH at 2500
    Then the bot's order reverts with PostOnlyWouldCross
    And the bot tried the place once

  @case:239 @perpdex
  Scenario: A reduce-only order with no position is surfaced
    Given a bot funded with $100000
    When the bot places a reduce-only sell of 1 ETH at 2400
    Then the bot's order reverts with ReduceOnlyViolation

  @case:240 @perpdex
  Scenario: A limit outside the band is surfaced
    Given a bot funded with $100000
    When the bot places a buy of 1 ETH at 3000
    Then the bot's order reverts with PriceOutOfBand

  @case:241 @perpdex
  Scenario: An order on a paused market is surfaced
    Given the admin sets market ETH to Paused
    And a bot funded with $100000
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with MarketPaused

  @case:242 @perpdex
  Scenario: An order on a settling market is surfaced
    Given the admin sets market ETH to Settling at 2500
    And a bot funded with $100000
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with MarketSettling

  @case:243 @perpdex
  Scenario: The bot cannot cross its own resting order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2499
    When the bot places a sell of 1 ETH at 2499
    Then the bot's order reverts with SelfTradePrevented

  # ---------------------------------------------------------------- lifecycle

  @case:244 @perpdex
  Scenario: The bot funds and initialises an account
    Given a bot funded with $50000
    Then the bot's account exists
    And the bot's vault balance is $50000

  @case:245 @perpdex
  Scenario: The bot places a limit and reads it back as planned
    Given a bot funded with $100000
    When the bot places a limit buy of 1.2345 ETH at 2498.567
    Then the bot's order is Open
    And the bot's order size is 1.234 ETH
    And the bot's order price is 2498.56

  @case:246 @perpdex
  Scenario: The bot cancels its order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    When the bot cancels its order
    Then the bot's order is Cancelled
    And the bot has 0 open orders

  @case:247 @perpdex
  Scenario: Cancel-all clears every resting order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot places a limit buy of 1 ETH at 2497
    And the bot places a limit buy of 1 ETH at 2496
    Then the bot has 3 open orders
    When the bot cancels all its orders
    Then the bot has 0 open orders

  @case:248 @perpdex
  Scenario: Flatten returns the bot to a clean slate after a fill
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot buys 1 ETH at market
    When the bot flattens ETH
    Then the bot is flat on ETH

  @case:249 @perpdex
  Scenario: A dry-run bot plans an order but places nothing on chain
    Given a dry-run bot funded with $100000
    When the bot places a limit buy of 1 ETH at 2498
    Then the order is cleared as a dry run
    And the bot has 0 open orders

  # ---------------------------------------------------------------- fills

  @case:250 @perpdex
  Scenario: A market buy fills against the backstop
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's ETH position size is 1 ETH
    And the backstop's ETH position size is -1 ETH

  @case:251 @perpdex
  Scenario: An IOC limit fills what it can and cancels the rest
    Given a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And a bot funded with $100000
    When the bot places an IOC buy of 3 ETH at 2500
    Then the bot's ETH position size is 1 ETH

  @case:252 @perpdex
  Scenario: A fill sets the position size and a positive entry price
    Given a bot funded with $100000
    When the bot buys 2 ETH at market
    Then the bot's ETH position size is 2 ETH
    And the bot's ETH entry price is above 0

  @case:253 @perpdex
  Scenario: A fill debits free collateral for the margin
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's free collateral fell

  @case:254 @perpdex
  Scenario: A taker fill pays a fee to the treasury
    Given the treasury's and insurance fund's vault balances are noted
    And a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the treasury's vault balance increased

  @case:255 @perpdex
  Scenario: A fill is mined and observable in the block it landed in
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's fill was mined
    And the bot's ETH position size is 1 ETH

  # ---------------------------------------------------------------- operations

  @case:256
  Scenario: The retry policy retries a transient failure but never a revert
    Given a risk-only bot with max order size 100 and max position 100
    Then a transient failure is retried up to the limit
    And a revert is surfaced on the first attempt

  @case:257 @perpdex
  Scenario: Three orders advance the account nonce by exactly three
    Given a bot funded with $100000
    When the bot places a limit buy of 1 ETH at 2498
    And the bot places a limit buy of 1 ETH at 2497
    And the bot places a limit buy of 1 ETH at 2496
    Then the account nonce advanced by 3

  @case:258 @perpdex
  Scenario: The bot halts when the exchange is paused
    Given a bot funded with $100000
    And the admin pauses the exchange
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with ExchangePaused

  @case:259 @perpdex
  Scenario: Cleanup leaves the venue flat, confirmed by re-reading
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot buys 1 ETH at market
    When the bot flattens ETH
    Then the bot is flat on ETH
    And the bot has 0 open orders

  @case:260
  Scenario: The bot holds and logs no secret
    Given a risk-only bot with max order size 100 and max position 100
    Then the bot's record contains no secret

  @case:261 @perpdex
  Scenario: Once the kill switch is thrown the bot sends nothing more
    Given a bot funded with $100000
    And the bot's kill switch is engaged
    When the bot places a limit buy of 1 ETH at 2498
    Then the order is refused with reason "kill-switch"
    And the bot has 0 open orders

  # ---------------------------------------------------------------- parameterised over the three markets

  @perpdex
  Scenario Outline: <sym>: the bot places a valid limit sized to clear the minimum notional
    Given a bot funded with $2000000
    When the bot places a limit buy of <size> <sym> at <price>
    Then the bot's order is Open
    And the bot's <sym> order clears the minimum notional

    @case:262
    Examples:
      | sym | size | price |
      | BTC | 0.01 | 59000 |

    @case:263
    Examples:
      | sym | size | price |
      | ETH | 0.1  | 2490  |

    @case:264
    Examples:
      | sym | size | price |
      | SOL | 1    | 99    |
